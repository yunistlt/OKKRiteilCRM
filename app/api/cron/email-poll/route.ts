/**
 * GET /api/cron/email-poll
 * Этап 1 фичи «Автоприём писем»: read-only вычитывает новые письма из общего ящика
 * (rop@zmktlt.ru) по IMAP и складывает их в incoming_emails. Без AI.
 *
 * - Инкрементально по UID (email_ingest_state.last_seen_uid). Флаг \Seen не трогаем.
 * - Дедуп по message_id, запасной — по (mailbox, folder, uid_validity, imap_uid).
 * - При смене UIDVALIDITY стартуем от текущего хвоста (ридер сам обнуляет точку отсчёта).
 */

// @ts-nocheck
import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { hasAnyRole } from '@/lib/rbac';
import { supabase } from '@/utils/supabase';
import { fetchNewEmails, fetchEmailContentByUid, isImapConfigured } from '@/lib/email/imap';
import { classifyRoute, isReplyThread, hasCrmOrderTag, isNoReplySender, loadSecretaryPrompt, stripHtml, extractLeadContact } from '@/lib/email/classify';
import { getAssignmentContext, resolveAssignment } from '@/lib/email/assign';
import { getDepartmentRoutes, isForwardEnabled, isDepartmentRoute, getOrderBlocklist, isSenderBlocked, getNoreplyAllowlist } from '@/lib/email/routes';
import { sendAppEmail, parseOrderNumberFromSubject } from '@/lib/email';
import { createEmailLead } from '@/lib/retailcrm/leads';
import { attachEmailFilesToOrder } from '@/lib/retailcrm/files';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const FOLDER = 'INBOX';
const MAX_BATCH = 30;          // письма за один заход (бережно к Yandex/OpenAI)
const CLASSIFY_BATCH = 30;     // классифицируем не больше N писем за заход
// Порог доверия «новой заявке» при ГОЛОМ «Re:» (без CRM-тега [#N/N]). Постоянный клиент часто
// отвечает на старое письмо, начиная НОВЫЙ запрос (КП/счёт) — голый «Re:» это слабый признак.
// Если ИИ уверенно (≥ порога) видит новую заявку — доверяем телу и заводим заказ. CRM-тег [#N/N]
// остаётся жёстким признаком переписки независимо от уверенности.
const BARE_RE_NEW_REQUEST_TRUST = 0.7;

async function setAgentStatus(status: string, task: string) {
    try {
        await supabase.from('okk_agent_status').upsert(
            { agent_id: 'katerina', name: 'Катерина', role: 'Секретарь', status, current_task: task,
              last_active_at: new Date().toISOString(), avatar_url: '/images/agents/katerina.svg' },
            { onConflict: 'agent_id' }
        );
    } catch { /* мониторинг не критичен */ }
}

function hasCronAuthorization(req: Request) {
    const authHeader = req.headers.get('authorization');
    return !process.env.CRON_SECRET || authHeader === `Bearer ${process.env.CRON_SECRET}`;
}

function escapeHtml(s: string): string {
    return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string));
}

/**
 * Пересылает оригинал письма (с вложениями) на адрес отдела. Бинарь вложений докачиваем
 * по IMAP UID (в БД его не храним). Reply-To = исходный отправитель, чтобы отдел отвечал клиенту.
 */
async function forwardToDepartment(opts: {
    toEmail: string;
    departmentLabel: string;
    folder: string;
    imapUid: number | null;
    fromEmail: string | null;
    fromName: string | null;
    subject: string | null;
    bodyTextFallback: string | null;
    bodyHtmlFallback: string | null;
    receivedAt: string | null;
}): Promise<{ sent: boolean; error?: string }> {
    let content = null as Awaited<ReturnType<typeof fetchEmailContentByUid>> | null;
    if (opts.imapUid != null) {
        try {
            content = await fetchEmailContentByUid(opts.imapUid, opts.folder);
        } catch (e: any) {
            console.warn('[email-poll] fetchEmailContentByUid failed:', e?.message || e);
        }
    }
    const fromEmail = content?.fromEmail || opts.fromEmail || '';
    const fromName = content?.fromName || opts.fromName || '';
    const subject = content?.subject || opts.subject || '(без темы)';
    const receivedAt = content?.receivedAt || opts.receivedAt || '';
    const bodyHtml = content?.bodyHtml || opts.bodyHtmlFallback || null;
    const bodyText = content?.bodyText || opts.bodyTextFallback || '';
    const attachments = content?.attachments || [];

    const header =
        `<div style="font:14px/1.5 Arial,sans-serif;color:#0f172a">` +
        `<p style="margin:0 0 8px"><b>Переслано Катериной (секретарь) в отдел «${escapeHtml(opts.departmentLabel)}».</b></p>` +
        `<p style="margin:0;color:#475569">От: ${escapeHtml(fromName)} &lt;${escapeHtml(fromEmail)}&gt;<br>` +
        `Тема: ${escapeHtml(subject)}<br>` +
        (receivedAt ? `Получено: ${escapeHtml(receivedAt)}<br>` : '') +
        `</p><hr style="border:none;border-top:1px solid #e2e8f0;margin:12px 0"></div>`;
    const bodyBlock = bodyHtml || `<pre style="font:13px/1.5 monospace;white-space:pre-wrap">${escapeHtml(bodyText)}</pre>`;

    return sendAppEmail({
        to: opts.toEmail,
        subject: `Fwd: ${subject}`,
        html: header + bodyBlock,
        fromName: 'Катерина (секретарь)',
        replyTo: fromEmail || undefined,
        attachments,
    });
}

export async function GET(req: Request) {
    const cronAuthorized = hasCronAuthorization(req);
    const session = cronAuthorized ? null : await getSession();
    if (!cronAuthorized && !hasAnyRole(session, ['admin', 'rop'])) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    if (!isImapConfigured()) {
        return NextResponse.json({ ok: false, error: 'imap_not_configured' }, { status: 200 });
    }

    const mailbox = process.env.IMAP_USER || process.env.SMTP_USER || '';

    try {
        // 1) Текущий указатель прогресса.
        const { data: stateRow } = await supabase
            .from('email_ingest_state')
            .select('last_seen_uid, uid_validity')
            .eq('mailbox', mailbox)
            .eq('folder', FOLDER)
            .maybeSingle();

        const lastSeenUid = Number(stateRow?.last_seen_uid ?? 0);
        const knownUidValidity = stateRow?.uid_validity != null ? Number(stateRow.uid_validity) : null;

        // 2) Читаем новые письма (read-only).
        const result = await fetchNewEmails({
            folder: FOLDER,
            lastSeenUid,
            knownUidValidity,
            maxBatch: MAX_BATCH,
            coldStartTailOnly: true,
        });

        let inserted = 0;
        let skipped = 0;

        if (result.emails.length > 0) {
            // 3) Дедуп до вставки: по message_id и по uid.
            const msgIds = result.emails.map((e) => e.messageId).filter(Boolean) as string[];
            const uids = result.emails.map((e) => e.imapUid);

            const existing = new Set<string>();
            if (msgIds.length > 0) {
                const { data } = await supabase
                    .from('incoming_emails')
                    .select('message_id')
                    .eq('mailbox', mailbox)
                    .in('message_id', msgIds);
                for (const r of data || []) if (r.message_id) existing.add('mid:' + r.message_id);
            }
            const existingUids = new Set<number>();
            {
                const { data } = await supabase
                    .from('incoming_emails')
                    .select('imap_uid')
                    .eq('mailbox', mailbox)
                    .eq('folder', FOLDER)
                    .eq('uid_validity', result.uidValidity)
                    .in('imap_uid', uids);
                for (const r of data || []) if (r.imap_uid != null) existingUids.add(Number(r.imap_uid));
            }

            const rows = [];
            for (const e of result.emails) {
                const dupByMid = e.messageId && existing.has('mid:' + e.messageId);
                const dupByUid = existingUids.has(e.imapUid);
                if (dupByMid || dupByUid) {
                    skipped++;
                    continue;
                }
                rows.push({
                    message_id: e.messageId,
                    mailbox,
                    folder: FOLDER,
                    imap_uid: e.imapUid,
                    uid_validity: e.uidValidity,
                    from_email: e.fromEmail,
                    from_name: e.fromName,
                    to_email: e.toEmail,
                    subject: e.subject,
                    in_reply_to: e.inReplyTo,
                    email_refs: e.references,
                    received_at: e.receivedAt,
                    body_text: e.bodyText,
                    body_html: e.bodyHtml,
                    has_attachments: e.hasAttachments,
                    attachments_meta: e.attachmentsMeta,
                    status: 'new',
                });
            }

            if (rows.length > 0) {
                const { error } = await supabase.from('incoming_emails').insert(rows);
                if (error) {
                    // На гонке (две параллельные выборки) возможен unique-violation — не падаем.
                    console.warn('[email-poll] insert warning:', error.message);
                }
                inserted = rows.length;
            }
        }

        // 4) Двигаем указатель прогресса.
        await supabase
            .from('email_ingest_state')
            .upsert(
                {
                    mailbox,
                    folder: FOLDER,
                    uid_validity: result.uidValidity,
                    last_seen_uid: result.maxUidFetched,
                    last_run_at: new Date().toISOString(),
                    updated_at: new Date().toISOString(),
                },
                { onConflict: 'mailbox,folder' }
            );

        // ── Фаза маршрутизации (агент-секретарь «Катерина»). ──
        // Один маршрут на письмо: заявка → заказ менеджеру; бухгалтерия/логистика/юрист → пересылка
        // в отдел; иначе пропуск. Сухой прогон: create_orders / forward_enabled = false.
        const classify = { reply_thread: 0, noreply: 0, not_request: 0, new_request: 0, blocked: 0, accounting: 0, logistics: 0, legal: 0, procurement: 0 };
        const { data: cfg } = await supabase.from('email_intake_config').select('create_orders').maybeSingle();
        const createOrders = Boolean(cfg?.create_orders); // false = сухой прогон заказов
        const [forwardEnabled, routes, orderBlocklist, noreplyAllowlist] = await Promise.all([isForwardEnabled(), getDepartmentRoutes(), getOrderBlocklist(), getNoreplyAllowlist()]);

        const { data: pending } = await supabase
            .from('incoming_emails')
            .select('id, from_email, from_name, subject, body_text, body_html, attachments_meta, folder, imap_uid, received_at')
            .eq('status', 'new')
            .order('received_at', { ascending: true })
            .limit(CLASSIFY_BATCH);

        if (pending && pending.length > 0) {
            await setAgentStatus('working', `Разбираю почту: ${pending.length} писем`);
            const [prompt, ctx] = await Promise.all([loadSecretaryPrompt(), getAssignmentContext()]);

            for (const e of pending) {
                let emailType: string, reasoning: string, confidence: number | null = null;
                let assignedManagerId: number | null = null;
                let orderBlocked = false; // отправитель в списке исключений → заказ не создаём
                let v: any = null;

                // Для «роботов-лидов» (webasyst и т.п.) или пересылаемых писем (Fwd) реальный контакт клиента — в теле письма,
                // а не в From. Тянем email/телефон/имя для карточки и назначения.
                const isRobotLead = isSenderBlocked(e.from_email, noreplyAllowlist);
                const isForwarded = (e.subject ? /^(?:fwd?|fw)\s*:/i.test(e.subject) : false) ||
                    (e.body_text ? /---\s*Пересылаемое сообщение\s*---|---\s*Forwarded message\s*---/i.test(e.body_text) : false) ||
                    (e.body_html ? /---\s*Пересылаемое сообщение\s*---|---\s*Forwarded message\s*---/i.test(stripHtml(e.body_html)) : false);
                const leadContact = (isRobotLead || isForwarded)
                    ? extractLeadContact((e.body_text && e.body_text.trim()) ? e.body_text : stripHtml(e.body_html))
                    : {};
                const custEmail = leadContact.email || e.from_email || '';
                const custName = leadContact.name || e.from_name || undefined;
                const custPhone = leadContact.phone || undefined;

                // noreply-отправитель пропускаем, КРОМЕ исключений (сайт-магазин webasyst и т.п.):
                // такие письма несут реальные лиды/заказы — их классифицируем как обычно.
                if (isNoReplySender(e.from_email) && !isSenderBlocked(e.from_email, noreplyAllowlist)) {
                    emailType = 'noreply'; reasoning = 'Робот-отправитель (noreply) — пропуск';
                } else {
                    v = await classifyRoute(
                        { fromEmail: e.from_email, fromName: e.from_name, subject: e.subject, bodyText: e.body_text, bodyHtml: e.body_html, attachments: e.attachments_meta },
                        prompt
                    );
                    // Сбой анализа (например, недоступен OpenAI): НЕ финализируем письмо — оставляем
                    // status='new', чтобы следующий крон повторил. Иначе транзиентная ошибка навсегда
                    // помечает заявку как «не заявка» и заказ не создаётся.
                    if (v.failed) {
                        console.warn('[email-poll] classify failed, will retry:', e.id, v.reasoning);
                        continue;
                    }
                    confidence = v.confidence;
                    reasoning = v.reasoning;
                    // Переписку по существующему заказу обрабатываем особо. Различаем два признака:
                    //  - CRM-тег [#N/N] (crmTag) — НАДЁЖНЫЙ: CRM сам вешает его на переписку по заказу;
                    //  - голый «Re:» без тега (bareRe) — СЛАБЫЙ: постоянный клиент часто отвечает на
                    //    старое письмо, начиная НОВЫЙ запрос (КП/счёт).
                    //  new_request: не плодим дубль заказа; procurement: не шлём в снабжение (холодное
                    //  предложение не приходит как «Re:» на наш заказ). Бухгалтерию/логистику/юриста по
                    //  переписке пересылать можно (вопрос по счёту/доставке/договору реально нужен отделу).
                    const crmTag = hasCrmOrderTag(e.subject);
                    const bareRe = !crmTag && isReplyThread(e.subject);
                    const noteFor = (route: string) => route === 'procurement' ? 'не пересылаем в снабжение' : 'заказ не создаём';
                    if (crmTag && (v.route === 'new_request' || v.route === 'procurement')) {
                        // Тег заказа — жёсткая переписка независимо от уверенности ИИ.
                        emailType = 'reply_thread';
                        reasoning = `Переписка по существующему заказу (тег [#…]) — ${noteFor(v.route)} | ${v.reasoning}`;
                    } else if (bareRe && v.route === 'procurement') {
                        // Снабжение по «Re:» на наш заказ — это переписка по нашей сделке, не новое предложение.
                        emailType = 'reply_thread';
                        reasoning = `Переписка по существующему заказу (Re: без тега) — не пересылаем в снабжение | ${v.reasoning}`;
                    } else if (bareRe && v.route === 'new_request' && v.confidence < BARE_RE_NEW_REQUEST_TRUST) {
                        // Голый «Re:» + НЕуверенная новая заявка → считаем перепиской по старой ветке.
                        // При уверенной новой заявке (≥ порога) НЕ перебиваем ИИ — заводим заказ (клиент
                        // просто ответил на прежнее письмо новым запросом).
                        emailType = 'reply_thread';
                        reasoning = `Переписка по существующему заказу (Re: без тега) — заказ не создаём | ${v.reasoning}`;
                    } else if (v.route === 'not_request' && crmTag) {
                        // ИИ счёл «не заявка», но в теме тег заказа [#N/N] — это переписка по заказу,
                        // а не «не заявка» (отказы «неактуально»/«нет финансирования» по заказу).
                        emailType = 'reply_thread';
                        reasoning = `Переписка по существующему заказу (тег [#…]) — ${v.reasoning}`;
                    } else {
                        emailType = v.route;
                    }
                    // Источник-робот с лидами (webasyst): если ИИ счёл «не заявка», но в теле есть контакт
                    // клиента (заявка с сайта, форма «Заказать звонок») — это всё равно лид → заводим заказ.
                    if (isRobotLead && emailType === 'not_request' && (leadContact.email || leadContact.phone)) {
                        emailType = 'new_request';
                        reasoning = `Заявка с сайта (форма/заказ) — контакт клиента в теле | ${v.reasoning}`;
                    }
                    if (emailType === 'new_request') {
                        if (isSenderBlocked(e.from_email, orderBlocklist)) {
                            // Контрагент в списке исключений: письмо разбираем, но НЕ ставим «Новая заявка»
                            // и не заводим заказ — отдельная метка «Контрагент в блоке». Менеджера не
                            // назначаем (чтобы не искажать баланс распределения).
                            orderBlocked = true;
                            emailType = 'blocked';
                            reasoning = `Контрагент в списке исключений — заказ не создаём | ${v.reasoning}`;
                        } else {
                            const a = await resolveAssignment(custEmail, ctx);
                            assignedManagerId = a.managerId;
                            reasoning = `${reasoning} | Назначение: ${a.reason}`;
                        }
                    }
                }
                classify[emailType as keyof typeof classify]++;

                let createdOrderId: number | null = null;
                let createdOrderNumber: string | null = null;

                // Разрешаем существующий заказ для переписки
                if (emailType === 'reply_thread') {
                    let orderNum: string | null = null;

                    // 1. Проверяем тему на наличие CRM-тега [#N/NNNNN]
                    if (e.subject) {
                        orderNum = parseOrderNumberFromSubject(e.subject);
                    }

                    // 2. Если не нашли, проверяем номер, возвращённый ИИ-классификатором
                    if (!orderNum && v && v.orderNumber) {
                        orderNum = v.orderNumber;
                    }

                    // 3. Если не нашли, ищем номер регулярным выражением в теме
                    if (!orderNum && e.subject) {
                        const m = e.subject.match(/(?:заказ|счет|№|order|invoice)\s*#?\s*(\d{4,6})/i);
                        if (m) orderNum = m[1];
                    }

                    // 4. Если не нашли, ищем регулярным выражением в начале тела письма
                    if (!orderNum && e.body_text) {
                        const m = e.body_text.slice(0, 1000).match(/(?:заказ|счет|№|order|invoice)\s*#?\s*(\d{4,6})/i);
                        if (m) orderNum = m[1];
                    }

                    // Привязываем ТОЛЬКО по явному номеру заказа (тег [#N/N] / номер в теме или теле).
                    // Фолбэк «последний заказ клиента по email» убран: он ложно привязывал НОВЫЙ запрос
                    // постоянного клиента к его старому заказу (инцидент: письмо-запрос КП уходило в
                    // «переписку по №…» вместо новой заявки). Нет явного номера → заказ не привязываем.
                    let resolvedOrder: { id: number; number: string } | null = null;
                    if (orderNum) {
                        const { data } = await supabase
                            .from('orders')
                            .select('id, number')
                            .eq('number', orderNum)
                            .limit(1)
                            .maybeSingle();
                        if (data) {
                            resolvedOrder = { id: Number(data.id), number: String(data.number) };
                        }
                    }

                    if (resolvedOrder) {
                        createdOrderId = resolvedOrder.id;
                        createdOrderNumber = resolvedOrder.number;
                        reasoning = `${reasoning} | Привязано к заказу №${resolvedOrder.number}`;
                    }
                }

                let forwardedDepartment: string | null = null;
                let forwardedTo: string | null = null;
                let forwardedAt: string | null = null;
                let forwardError: string | null = null;
                let finalStatus = 'classified';
                let errorMessage: string | null = null;

                // 1) Новая заявка → создание заказа (если режим включён и отправитель не в исключениях).
                if (createOrders && emailType === 'new_request' && !orderBlocked) {
                    try {
                        const bodyForComment = (e.body_text && e.body_text.trim()) ? e.body_text : stripHtml(e.body_html);
                        const attNames = (Array.isArray(e.attachments_meta) ? e.attachments_meta : [])
                            .map((a: any) => a?.filename).filter(Boolean);

                        // Предварительно скачиваем файлы вложений и извлекаем из них текст для поиска дубликатов
                        const hasAtt = Array.isArray(e.attachments_meta) && e.attachments_meta.length > 0;
                        let files: any[] = [];
                        let attachmentText = '';
                        if (hasAtt && e.imap_uid != null) {
                            try {
                                const content = await fetchEmailContentByUid(Number(e.imap_uid), e.folder || FOLDER);
                                files = content?.attachments || [];
                                if (files.length > 0) {
                                    const { extractTextFromBuffer } = await import('@/lib/email/attachment-parser');
                                    for (const file of files) {
                                        const text = await extractTextFromBuffer(file.content, file.filename);
                                        if (text) {
                                            attachmentText += `\n[Файл: ${file.filename}]\n${text}`;
                                        }
                                    }
                                }
                            } catch (attErr: any) {
                                console.error('Ошибка предварительного скачивания/парсинга вложений:', attErr);
                            }
                        }

                        const order = await createEmailLead({
                            email: custEmail || '',
                            name: custName,
                            phone: custPhone,
                            subject: e.subject || undefined,
                            bodySnippet: (bodyForComment || '').slice(0, 1500),
                            attachmentNames: attNames,
                            managerId: assignedManagerId,
                            corporateDetails: v?.corporateDetails || null,
                            attachmentText: attachmentText || undefined,
                        });
                        createdOrderId = order.id;
                        createdOrderNumber = order.number;
                        finalStatus = 'processed';
                        reasoning = `${reasoning} | Заказ №${order.number} создан`;

                        // Вложения письма → в заказ (ТЗ обычно во вложении). Реиспользуем уже скачанные файлы.
                        if (files.length > 0) {
                            try {
                                const att = await attachEmailFilesToOrder(order.id, files);
                                reasoning = `${reasoning} | Вложения в заказ: ${att.attached}/${att.total}` +
                                    (att.errors.length ? ` (ошибки: ${att.errors.slice(0, 2).join('; ')})` : '');
                            } catch (attErr: any) {
                                reasoning = `${reasoning} | Вложения не прикреплены: ${attErr?.message || 'ошибка'}`;
                            }
                        }
                    } catch (err: any) {
                        finalStatus = 'error';
                        errorMessage = err?.message || 'order_create_failed';
                        reasoning = `${reasoning} | Ошибка создания заказа: ${errorMessage}`;
                    }
                }

                // 2) Отдел → пересылка оригинала (если режим включён и адрес отдела настроен).
                if (isDepartmentRoute(emailType as any)) {
                    forwardedDepartment = emailType;
                    const route = routes[emailType];
                    const dest = route?.isActive ? route.email : null;
                    if (!dest) {
                        finalStatus = 'needs_review';
                        reasoning = `${reasoning} | Адрес отдела «${route?.label || emailType}» не настроен — переслать вручную`;
                    } else if (!forwardEnabled) {
                        reasoning = `${reasoning} | Сухой прогон пересылки (в «${route.label}» не отправлено)`;
                    } else {
                        const r = await forwardToDepartment({
                            toEmail: dest,
                            departmentLabel: route.label,
                            folder: e.folder || FOLDER,
                            imapUid: e.imap_uid != null ? Number(e.imap_uid) : null,
                            fromEmail: e.from_email,
                            fromName: e.from_name,
                            subject: e.subject,
                            bodyTextFallback: e.body_text,
                            bodyHtmlFallback: e.body_html,
                            receivedAt: e.received_at,
                        });
                        if (r.sent) {
                            forwardedTo = dest;
                            forwardedAt = new Date().toISOString();
                            finalStatus = 'processed';
                            reasoning = `${reasoning} | Переслано в «${route.label}» (${dest})`;
                        } else {
                            finalStatus = 'error';
                            forwardError = r.error || 'forward_failed';
                            reasoning = `${reasoning} | Ошибка пересылки в «${route.label}»: ${forwardError}`;
                        }
                    }
                }

                await supabase.from('incoming_emails').update({
                    email_type: emailType,
                    confidence,
                    reasoning,
                    assigned_manager_id: assignedManagerId,
                    created_crm_order_id: createdOrderId,
                    created_crm_order_number: createdOrderNumber,
                    forwarded_department: forwardedDepartment,
                    forwarded_to: forwardedTo,
                    forwarded_at: forwardedAt,
                    forward_error: forwardError,
                    classified_by: 'ai',
                    status: finalStatus,
                    error_message: errorMessage,
                    updated_at: new Date().toISOString(),
                }).eq('id', e.id);
            }
        }
        await setAgentStatus('idle', 'Ожидает новые письма');

        return NextResponse.json({
            ok: true,
            mailbox,
            fetched: result.emails.length,
            inserted,
            skipped,
            classified: classify,
            dryRun: !createOrders,
            forwardDryRun: !forwardEnabled,
            lastSeenUidBefore: result.lastSeenUidBefore,
            lastSeenUidAfter: result.maxUidFetched,
            uidValidity: result.uidValidity,
        });
    } catch (e: any) {
        console.error('[email-poll] error:', e?.message || e);
        return NextResponse.json({ ok: false, error: e?.message || 'poll_failed' }, { status: 500 });
    }
}
