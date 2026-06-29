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
import { classifyRoute, isReplyThread, isNoReplySender, loadSecretaryPrompt } from '@/lib/email/classify';
import { getManagerPool, getManagerNames, getBalanceWindowDays, getRecentAssignmentCounts, resolveAssignment } from '@/lib/email/assign';
import { getDepartmentRoutes, isForwardEnabled, isDepartmentRoute } from '@/lib/email/routes';
import { sendAppEmail } from '@/lib/email';
import { createEmailLead } from '@/lib/retailcrm/leads';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const FOLDER = 'INBOX';
const MAX_BATCH = 30;          // письма за один заход (бережно к Yandex/OpenAI)
const CLASSIFY_BATCH = 30;     // классифицируем не больше N писем за заход

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
        const classify = { reply_thread: 0, noreply: 0, not_request: 0, new_request: 0, accounting: 0, logistics: 0, legal: 0, procurement: 0 };
        const { data: cfg } = await supabase.from('email_intake_config').select('create_orders').maybeSingle();
        const createOrders = Boolean(cfg?.create_orders); // false = сухой прогон заказов
        const [forwardEnabled, routes] = await Promise.all([isForwardEnabled(), getDepartmentRoutes()]);

        const { data: pending } = await supabase
            .from('incoming_emails')
            .select('id, from_email, from_name, subject, body_text, body_html, folder, imap_uid, received_at')
            .eq('status', 'new')
            .order('received_at', { ascending: true })
            .limit(CLASSIFY_BATCH);

        if (pending && pending.length > 0) {
            await setAgentStatus('working', `Разбираю почту: ${pending.length} писем`);
            const [prompt, pool] = await Promise.all([loadSecretaryPrompt(), getManagerPool()]);
            const [names, windowDays] = await Promise.all([getManagerNames(pool), getBalanceWindowDays()]);
            const load = await getRecentAssignmentCounts(pool, windowDays);
            const ctx = { pool, load, managerNames: names };

            for (const e of pending) {
                let emailType: string, reasoning: string, confidence: number | null = null;
                let assignedManagerId: number | null = null;

                if (isNoReplySender(e.from_email)) {
                    emailType = 'noreply'; reasoning = 'Робот-отправитель (noreply) — пропуск';
                } else {
                    const v = await classifyRoute(
                        { fromEmail: e.from_email, fromName: e.from_name, subject: e.subject, bodyText: e.body_text },
                        prompt
                    );
                    confidence = v.confidence;
                    reasoning = v.reasoning;
                    // Переписку по существующему заказу (Re/тег CRM) не превращаем в НОВУЮ заявку
                    // (иначе плодим дубли заказов), но в отдел по содержанию переслать можно.
                    if (v.route === 'new_request' && isReplyThread(e.subject)) {
                        emailType = 'reply_thread';
                        reasoning = `Переписка по существующему заказу (Re/тег) — заказ не создаём | ${v.reasoning}`;
                    } else {
                        emailType = v.route;
                    }
                    if (emailType === 'new_request') {
                        const a = await resolveAssignment(e.from_email || '', ctx);
                        assignedManagerId = a.managerId;
                        reasoning = `${reasoning} | Назначение: ${a.reason}`;
                    }
                }
                classify[emailType as keyof typeof classify]++;

                let createdOrderId: number | null = null;
                let createdOrderNumber: string | null = null;
                let forwardedDepartment: string | null = null;
                let forwardedTo: string | null = null;
                let forwardedAt: string | null = null;
                let forwardError: string | null = null;
                let finalStatus = 'classified';
                let errorMessage: string | null = null;

                // 1) Новая заявка → создание заказа (если режим включён).
                if (createOrders && emailType === 'new_request') {
                    try {
                        const order = await createEmailLead({
                            email: e.from_email || '',
                            name: e.from_name || undefined,
                            subject: e.subject || undefined,
                            bodySnippet: (e.body_text || '').slice(0, 1500),
                            managerId: assignedManagerId,
                        });
                        createdOrderId = order.id;
                        createdOrderNumber = order.number;
                        finalStatus = 'processed';
                        reasoning = `${reasoning} | Заказ №${order.number} создан`;
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
