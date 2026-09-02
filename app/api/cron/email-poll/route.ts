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
import { classifyRoute, isReplyThread, hasCrmOrderTag, isNoReplySender, loadSecretaryPrompt, stripHtml, extractLeadContact, ourOutboundDomain, repliesToOurOutbound } from '@/lib/email/classify';
import { buildCrmDossier } from '@/lib/email/dossier';
import { getAssignmentContext, resolveAssignment } from '@/lib/email/assign';
import { getDepartmentRoutes, isForwardEnabled, isDepartmentRoute, getOrderBlocklist, isSenderBlocked, getNoreplyAllowlist, getCrmTagStaleDays, getThreadDedupDays } from '@/lib/email/routes';
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

/**
 * Голый «Re:» без CRM-тега: ищем в ТЕМЕ номер заказа ЭТОГО ЖЕ клиента. Менеджеры часто вписывают
 * номер в тему руками («Re: Запрос КП 53929 КП с НДС 5%…»), и тег [#N/N] в ветке отсутствует —
 * надёжный признак переписки не срабатывает, а ИИ уверенно видит «новую заявку».
 *
 * Номер отдаём ТОЛЬКО если такой заказ есть в базе И принадлежит тому же email — иначе случайное
 * число из темы (год, сумма) привязало бы письмо к чужому заказу.
 *
 * Инцидент 21.07.2026: три ответа клиента в ветке заказа 53929 («доп.скидка?», «обрешётка нужна?»,
 * «по торгам не прошли») завели три заказа-дубля 53940/53941/53947 — confidence был 0.9–1.0,
 * порог BARE_RE_NEW_REQUEST_TRUST не спасал.
 */
async function findClientOrderNumberInSubject(subject?: string | null, email?: string | null): Promise<string | null> {
    if (!subject || !email) return null;
    // Отдельно стоящие числа 4–6 цифр: не куски телефона/ИНН и не дробные суммы.
    const nums = Array.from(new Set(subject.match(/(?<![\d.,])\d{4,6}(?![\d.,])/g) || []));
    if (nums.length === 0) return null;
    const { data } = await supabase
        .from('orders')
        .select('number, raw_payload')
        .in('number', nums)
        .limit(20);
    if (!data || data.length === 0) return null;
    const target = email.trim().toLowerCase();
    const mine = data.filter((o: any) => {
        const p = o?.raw_payload || {};
        const emails = [p.email, p.customer?.email].filter(Boolean).map((x: string) => String(x).trim().toLowerCase());
        return emails.includes(target);
    });
    if (mine.length === 0) return null;
    // Несколько номеров в теме — берём самый свежий (больший) заказ.
    mine.sort((a: any, b: any) => Number(b.number) - Number(a.number));
    return String(mine[0].number);
}

/**
 * CRM-тег [#N/NNNNN] в теме указывает на ДАВНО ЗАКРЫТЫЙ заказ → тег «протух».
 * Обычно тег — жёсткий признак живой переписки по сделке (CRM сама его вешает). Но клиент может
 * переслать (Fwd:) свою же ветку многолетней давности с НОВЫМ запросом — «актуализируйте цену по
 * ранее заказанному». Тогда тег про старую сделку, а письмо — новая заявка.
 *
 * Протухшим считаем ТОЛЬКО при обоих условиях сразу (осознанно консервативно, чтобы не плодить
 * дубли по живым веткам):
 *   1) по заказу давно НЕТ ДВИЖЕНИЯ: последняя смена статуса (raw_payload.statusUpdatedAt, фолбэк —
 *      дата создания) старше `staleDays` (email_intake_config.crm_tag_stale_days). Берём движение,
 *      а не возраст заказа: сделка может тянуться год и оставаться живой (заказ 45228 создан 490
 *      дней назад, но статус менялся вчера — тег живой);
 *   2) статус заказа не помечен рабочим (status_settings.is_working = true) — тендер и другие
 *      долгоиграющие рабочие статусы оставляют тег жёстким даже без движения. Справочник неполный
 *      (в нём нет `otgruzen`/`complete`/`send-assembling`), поэтому это страховка, а не основной
 *      критерий — основной критерий пункт 1.
 *
 * Инцидент 30.07.2026: «Fwd: [#2/25609] … по заказу № 25609» (заказ от 14.03.2023, статус complete,
 * движения с июля 2023) — запрос актуальной цены на стеллажи ушёл в reply_thread, заказ не создан.
 */
async function findStaleTaggedOrder(
    subject: string | null | undefined,
    staleDays: number
): Promise<{ number: string; idleDays: number; status: string | null } | null> {
    if (!subject) return null;
    const num = parseOrderNumberFromSubject(subject);
    if (!num) return null;
    const { data } = await supabase.from('orders').select('number, status, created_at, raw_payload').eq('number', num).limit(1);
    const ord = data?.[0];
    if (!ord) return null; // заказа нет в базе — судить не о чем, тег оставляем жёстким
    // statusUpdatedAt приходит из CRM без таймзоны («2023-07-06 12:57:42») — приводим к ISO-виду.
    const rawMoved = ord.raw_payload?.statusUpdatedAt;
    const movedAt = rawMoved ? new Date(String(rawMoved).replace(' ', 'T')) : null;
    const lastMove = (movedAt && !Number.isNaN(movedAt.getTime()))
        ? movedAt
        : (ord.created_at ? new Date(ord.created_at) : null);
    if (!lastMove || Number.isNaN(lastMove.getTime())) return null;
    const idleDays = Math.floor((Date.now() - lastMove.getTime()) / 86400000);
    if (idleDays < staleDays) return null;
    const { data: st } = await supabase.from('status_settings').select('is_working').eq('code', ord.status || '').maybeSingle();
    if (st?.is_working === true) return null; // заказ в рабочем статусе — переписка живая
    return { number: String(ord.number), idleDays, status: ord.status || null };
}

/** Идентификаторы писем треда: Message-ID + In-Reply-To + References. */
function threadIds(e: { message_id?: string | null; in_reply_to?: string | null; email_refs?: string | string[] | null }): string[] {
    const refs = Array.isArray(e.email_refs) ? e.email_refs.join(' ') : (e.email_refs || '');
    return Array.from(new Set(
        `${e.message_id || ''} ${e.in_reply_to || ''} ${refs}`
            .split(/\s+/)
            .map((s) => s.trim())
            .filter((s) => s.startsWith('<') && s.length > 3)
    ));
}

/**
 * Письмо продолжает ПОЧТОВЫЙ ТРЕД, по которому заказ уже создан → новый заказ не нужен.
 *
 * Зачем именно тред. За 60 дней менеджеры пометили «Дубль заявки» 78 из 399 заказов Катерины (20%).
 * На этой разметке проверены признаки: сходство текста писем НЕ разделяет дубль и законную повторную
 * заявку того же клиента (медиана 0.79 против 0.80 — при любом пороге примерно 50/50), совпадение
 * темы тоже (47% против 39%). Разделяет только общий тред: 21% у дублей против 4% у законных.
 * Поэтому жёстко дедуплицируем ТОЛЬКО тред, а остальное — мягкой пометкой (см. createEmailLead).
 *
 * Инцидент 31.07.2026: письмо «Описание» пришло через 4 минуты после «Запрос» от того же клиента —
 * заказ 54078 оказался дублем 54077.
 */
async function findOrderByEmailThread(
    e: { id: string; message_id?: string | null; in_reply_to?: string | null; email_refs?: string | string[] | null },
    windowDays: number
): Promise<{ number: string; id: number | null } | null> {
    const ids = threadIds(e);
    if (ids.length === 0) return null;
    const since = new Date(Date.now() - windowDays * 86400000).toISOString();
    // Письма того же треда, по которым заказ уже заведён. Тред опознаём по пересечению
    // Message-ID/In-Reply-To/References — цитата тела здесь не нужна (её ловит repliesToOurOutbound).
    const { data } = await supabase
        .from('incoming_emails')
        .select('id, message_id, in_reply_to, email_refs, created_crm_order_number, created_crm_order_id, received_at')
        .not('created_crm_order_number', 'is', null)
        .gte('received_at', since)
        .order('received_at', { ascending: false })
        .limit(400);
    if (!data?.length) return null;
    const mine = new Set(ids);
    for (const prev of data) {
        if (prev.id === e.id) continue;
        if (threadIds(prev).some((x) => mine.has(x))) {
            return { number: String(prev.created_crm_order_number), id: prev.created_crm_order_id ? Number(prev.created_crm_order_id) : null };
        }
    }
    return null;
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
        const [forwardEnabled, routes, orderBlocklist, noreplyAllowlist, crmTagStaleDays, threadDedupDays] = await Promise.all([isForwardEnabled(), getDepartmentRoutes(), getOrderBlocklist(), getNoreplyAllowlist(), getCrmTagStaleDays(), getThreadDedupDays()]);

        const { data: pending } = await supabase
            .from('incoming_emails')
            .select('id, from_email, from_name, subject, body_text, body_html, attachments_meta, folder, imap_uid, received_at, message_id, in_reply_to, email_refs')
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
                let subjectOrderNum: string | null = null; // номер заказа клиента, найденный в теме «Re:»
                let threadOrder: { number: string; id: number | null } | null = null; // заказ из того же почтового треда

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
                    // Досье из CRM: проверяем факты (есть ли заказ с номером из письма, история клиента)
                    // ДО обращения к ИИ и отдаём их вместе с письмом — решение по фактам, а не по словам.
                    const crmDossier = await buildCrmDossier({
                        fromEmail: e.from_email,
                        subject: e.subject,
                        body: (e.body_text && e.body_text.trim()) ? e.body_text : stripHtml(e.body_html),
                        contactEmail: leadContact.email || null,
                        excludeEmailId: e.id,
                    });
                    v = await classifyRoute(
                        { fromEmail: e.from_email, fromName: e.from_name, subject: e.subject, bodyText: e.body_text, bodyHtml: e.body_html, attachments: e.attachments_meta, crmDossier },
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
                    // Конкретный НОВЫЙ запрос на просчёт в теле (позиция + количество/характеристики).
                    // Сильнее двух вещей:
                    //  1) ошибочной бухгалтерии — в бухгалтерию только вопросы по ДОКУМЕНТАМ;
                    //  2) слабых признаков переписки (ответ в нашей ветке, голый «Re:») — клиент
                    //     отвечает на старое письмо, начиная новый запрос.
                    // Инцидент 11.08.2026: «RE: RE: Запрос КП 51672 … с НДС 5%» с запросом цены на
                    // Топтыжку 4 (20 шт, Нефтеюганск) ушёл в бухгалтерию, заявка не создалась.
                    const newInquiry = v.newInquiry === true;
                    const aiRoute: string = (v.route === 'accounting' && newInquiry) ? 'new_request' : v.route;
                    if (aiRoute !== v.route) {
                        reasoning = `Запрос цены/сроков на конкретную позицию — это заявка, не бухгалтерия | ${v.reasoning}`;
                    }
                    const noteFor = (route: string) => route === 'procurement' ? 'не пересылаем в снабжение' : 'заказ не создаём';
                    // Голый «Re:»/«Fwd:» + письмо ЦИТИРУЕТ наше исходящее (заголовок-ответ на наш релей
                    // или наш домен в теле-цитате) — надёжный признак переписки по существующему заказу
                    // даже без тега [#N/N] и без номера в теме (инцидент 23.07.2026, 53987/53986).
                    const repliesToOurThread = (bareRe || isForwarded) && repliesToOurOutbound(
                        { inReplyTo: e.in_reply_to, refs: e.email_refs, bodyText: e.body_text, bodyHtml: e.body_html },
                        ourOutboundDomain()
                    );
                    // Голый «Re:» + номер существующего заказа этого же клиента в теме — такой же
                    // надёжный признак переписки, как CRM-тег (см. findClientOrderNumberInSubject).
                    subjectOrderNum = (bareRe && (aiRoute === 'new_request' || aiRoute === 'not_request'))
                        ? await findClientOrderNumberInSubject(e.subject, custEmail)
                        : null;
                    // Тег указывает на давно закрытый заказ — переписка по нему не идёт (см.
                    // findStaleTaggedOrder). Проверяем ДО остальных правил: у пересланной старой
                    // ветки сработали бы и тег, и repliesToOurThread (в теле цитата нашего письма).
                    // Тред-дедуп проверяем ПЕРВЫМ: если по этой же переписке заказ уже заведён,
                    // разбирать письмо как новую заявку незачем — какими бы ни были тег и «Re:».
                    threadOrder = aiRoute === 'new_request'
                        ? await findOrderByEmailThread(e, threadDedupDays)
                        : null;
                    const staleTag = !threadOrder && crmTag && aiRoute === 'new_request'
                        ? await findStaleTaggedOrder(e.subject, crmTagStaleDays)
                        : null;
                    if (threadOrder) {
                        emailType = 'reply_thread';
                        reasoning = `Продолжение переписки, по которой заказ №${threadOrder.number} уже создан — дубль не заводим | ${v.reasoning}`;
                    } else if (staleTag) {
                        // Не перебиваем ИИ: это новое обращение по старой сделке — заводим заказ.
                        emailType = 'new_request';
                        reasoning = `Тег [#…] на давно закрытом заказе №${staleTag.number} (без движения ${staleTag.idleDays} дн.) — считаем новым обращением | ${v.reasoning}`;
                    } else if (crmTag && (aiRoute === 'new_request' || aiRoute === 'procurement')) {
                        // Тег заказа — жёсткая переписка независимо от уверенности ИИ.
                        emailType = 'reply_thread';
                        reasoning = `Переписка по существующему заказу (тег [#…]) — ${noteFor(aiRoute)} | ${v.reasoning}`;
                    } else if (bareRe && aiRoute === 'procurement') {
                        // Снабжение по «Re:» на наш заказ — это переписка по нашей сделке, не новое предложение.
                        emailType = 'reply_thread';
                        reasoning = `Переписка по существующему заказу (Re: без тега) — не пересылаем в снабжение | ${v.reasoning}`;
                    } else if (bareRe && subjectOrderNum && !newInquiry && (aiRoute === 'new_request' || aiRoute === 'not_request')) {
                        // «Re:» + номер заказа этого клиента в теме → переписка по нему независимо от
                        // уверенности ИИ (менеджер вписала номер руками, тега [#N/N] в ветке нет).
                        emailType = 'reply_thread';
                        reasoning = `Переписка по заказу №${subjectOrderNum} (Re: + номер заказа клиента в теме) — ${noteFor(aiRoute)} | ${v.reasoning}`;
                    } else if (repliesToOurThread && !newInquiry && (aiRoute === 'new_request' || aiRoute === 'not_request')) {
                        // «Re:»/«Fwd:» + письмо цитирует НАШЕ исходящее, но номера заказа в теме нет
                        // (иначе сработала бы ветка subjectOrderNum выше). Это ответ клиента в уже
                        // существующей переписке, а НЕ новая заявка — не плодим дубль, ДАЖЕ если ИИ
                        // уверен (холодный лид процитировать нас не может). К заказу не привязываем
                        // (явного номера нет). Инцидент 23.07.2026: 53987 («пока нет инфо»), 53986.
                        emailType = 'reply_thread';
                        reasoning = `Переписка по существующему заказу (ответ на наше письмо, без номера в теме) — ${noteFor(aiRoute)} | ${v.reasoning}`;
                    } else if (bareRe && !newInquiry && aiRoute === 'new_request' && v.confidence < BARE_RE_NEW_REQUEST_TRUST) {
                        // Голый «Re:» + НЕуверенная новая заявка → считаем перепиской по старой ветке.
                        // При уверенной новой заявке (≥ порога) НЕ перебиваем ИИ — заводим заказ (клиент
                        // просто ответил на прежнее письмо новым запросом).
                        emailType = 'reply_thread';
                        reasoning = `Переписка по существующему заказу (Re: без тега) — заказ не создаём | ${v.reasoning}`;
                    } else if (aiRoute === 'not_request' && crmTag) {
                        // ИИ счёл «не заявка», но в теме тег заказа [#N/N] — это переписка по заказу,
                        // а не «не заявка» (отказы «неактуально»/«нет финансирования» по заказу).
                        emailType = 'reply_thread';
                        reasoning = `Переписка по существующему заказу (тег [#…]) — ${v.reasoning}`;
                    } else {
                        emailType = aiRoute;
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
                    // 0. Заказ, найденный по почтовому треду (самый надёжный), затем — номер из темы
                    let orderNum: string | null = threadOrder?.number || subjectOrderNum;

                    // 1. Проверяем тему на наличие CRM-тега [#N/NNNNN]
                    if (!orderNum && e.subject) {
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

                // Письмо продолжает тред уже созданного заказа: сам заказ не плодим, но вложения
                // (обычно там ТЗ/спецификация) прикрепляем к нему — иначе файлы потерялись бы.
                if (createOrders && emailType === 'reply_thread' && threadOrder?.id
                    && Array.isArray(e.attachments_meta) && e.attachments_meta.length > 0 && e.imap_uid != null) {
                    try {
                        const content = await fetchEmailContentByUid(Number(e.imap_uid), e.folder || FOLDER);
                        const files = content?.attachments || [];
                        if (files.length > 0) {
                            const att = await attachEmailFilesToOrder(threadOrder.id, files);
                            reasoning = `${reasoning} | Вложения в заказ №${threadOrder.number}: ${att.attached}/${att.total}` +
                                (att.errors.length ? ` (ошибки: ${att.errors.slice(0, 2).join('; ')})` : '');
                        }
                    } catch (attErr: any) {
                        reasoning = `${reasoning} | Вложения не прикреплены: ${attErr?.message || 'ошибка'}`;
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
