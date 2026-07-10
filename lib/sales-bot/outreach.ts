// Артём (РОП-бот): исходящее приглашение новых заявок на квалификацию.
//
// Поток: новый заказ (status = pickup_status) → назначаем на бота-квалификатора
// (Теренков, manager_id) → шлём клиенту письмо с UTM-ссылкой на виджет Елены
// (?utm_campaign=<orderId> включает режим квалификации) → логируем.
// Дальше клиент кликает, проходит 7 вопросов у Елены, крон /api/cron/lead-catcher
// (Семён) пишет ответы в CRM, ставит «Заявка квалифицирована» (zapros-kontaktov)
// и переназначает на живого менеджера.
//
// Зависшие заявки (клиент не кликнул за timeout_hours) возвращаем живому менеджеру.
//
// Безопасность: при settings.enabled = false работаем в «сухом» прогоне —
// логируем намерение (outcome = 'dry_run'), но НЕ переназначаем и НЕ шлём писем.
import { supabase } from '@/utils/supabase';
import { updateExistingOrderInCrm } from '@/lib/retailcrm/leads';
import { sendOrderEmail } from '@/lib/email';
import { getAssignmentContext, resolveAssignment } from '@/lib/email/assign';

export interface OutreachSettings {
    enabled: boolean;
    exclude_known_clients: boolean;
    require_legal_entity: boolean;
    rate_per_hour: number;
    bot_manager_id: number;
    pickup_status: string;
    timeout_hours: number;
    site_base_url: string;
}

const DEFAULTS: OutreachSettings = {
    enabled: false,
    exclude_known_clients: false, // приглашаем и постоянных (у них — короткая квалификация по заявке)
    require_legal_entity: false,
    rate_per_hour: 10,
    bot_manager_id: 102,
    pickup_status: 'novyi-1',
    timeout_hours: 24,
    site_base_url: 'https://www.zmktlt.ru',
};

export async function getOutreachSettings(): Promise<OutreachSettings> {
    const { data } = await supabase
        .from('rop_outreach_settings')
        .select('*')
        .eq('id', 1)
        .maybeSingle();
    if (!data) return { ...DEFAULTS };
    return { ...DEFAULTS, ...data } as OutreachSettings;
}

/** Достаёт email клиента из raw_payload заказа (customer → contact → верхний уровень). */
export function extractCustomerEmail(raw: any): string | null {
    const cands = [
        raw?.customer?.email,
        raw?.contact?.email,
        raw?.email,
    ];
    for (const c of cands) {
        if (typeof c === 'string' && /\S+@\S+\.\S+/.test(c.trim())) return c.trim();
    }
    return null;
}

/** Имя для приветствия. «Клиент» и пустышки не считаем именем. */
export function extractFirstName(raw: any): string | null {
    const name = (raw?.firstName || raw?.customer?.firstName || raw?.contact?.firstName || '').trim();
    if (!name) return null;
    if (/^клиент$/i.test(name)) return null;
    return name;
}

/** Постоянный клиент: по заказу видно > 1 заказа за этим customer. */
export function isKnownClient(raw: any): boolean {
    const cnt = Number(raw?.customer?.ordersCount ?? 0);
    return cnt > 1;
}

/**
 * Прибавляет N рабочих часов, НЕ считая выходные (Сб/Вс по московскому времени).
 * Например, заявка в пятницу 18:00 + 24 рабочих часа → понедельник 18:00.
 */
export function addBusinessHours(from: Date, hours: number): Date {
    const MSK_OFFSET_MS = 3 * 3600 * 1000; // Europe/Moscow (UTC+3, без перехода)
    let cur = from.getTime();
    let remaining = hours;
    while (remaining > 0) {
        cur += 3600 * 1000; // шаг в 1 час
        const dow = new Date(cur + MSK_OFFSET_MS).getUTCDay(); // 0=Вс, 6=Сб по МСК
        if (dow !== 0 && dow !== 6) remaining--; // рабочий час засчитываем
    }
    return new Date(cur);
}

/** Юрлицо ли (для опционального фильтра require_legal_entity). */
export function isLegalEntity(raw: any): boolean {
    const t = (raw?.customer?.contragent?.contragentType || raw?.contragent?.contragentType || '').toLowerCase();
    return t === 'legal-entity' || t === 'legal_entity';
}

/** Собирает письмо-приглашение от Артёма со ссылкой на виджет в режиме квалификации. */
export function composeInviteEmail(order: {
    orderId: number;
    number: string;
    firstName: string | null;
    siteBaseUrl: string;
}): { subjectText: string; html: string; fromName: string } {
    const link = `${order.siteBaseUrl.replace(/\/$/, '')}/?utm_source=rop_bot&utm_medium=email&utm_campaign=${order.orderId}`;
    const greeting = order.firstName ? `Здравствуйте, ${order.firstName}!` : 'Здравствуйте!';
    const subjectText = `ваша заявка №${order.number}`;

    const html = `
<div style="font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;font-size:15px;color:#0f172a;line-height:1.6;max-width:560px">
  <p>${greeting}</p>
  <p>Мы получили вашу заявку <b>№${order.number}</b> и готовы подготовить точный расчёт и коммерческое предложение.</p>
  <p>Чтобы инженер-технолог сразу посчитал верно, нужно уточнить несколько параметров.
     Это займёт пару минут в чате — просто перейдите по ссылке:</p>
  <p style="margin:22px 0">
    <a href="${link}"
       style="display:inline-block;background:#2563eb;color:#fff;text-decoration:none;
              padding:12px 22px;border-radius:8px;font-weight:600">
      Ответить на вопросы по заявке
    </a>
  </p>
  <p style="color:#475569;font-size:13px">Или скопируйте ссылку в браузер:<br>
     <a href="${link}" style="color:#2563eb">${link}</a></p>
  <p style="margin-top:24px">С уважением,<br>Елена, отдел продаж ЗМКТЛТ</p>
</div>`.trim();

    return { subjectText, html, fromName: 'Елена, ЗМКТЛТ' };
}

interface OrderRow {
    order_id: number;
    number: string;
    status: string;
    manager_id: number | null;
    raw_payload: any;
    created_at: string;
}

export interface OutreachRunResult {
    dryRun: boolean;
    scanned: number;
    sent: number;
    skipped: Record<string, number>;
    failed: number;
    details: Array<{ order: number; outcome: string; reason?: string }>;
}

/**
 * Основной проход: находит новые заказы и приглашает их на квалификацию.
 * dryRun = true (или settings.enabled = false) — только логирует, ничего не шлёт.
 */
export async function runOutreachBatch(opts?: { dryRun?: boolean; limit?: number }): Promise<OutreachRunResult> {
    const settings = await getOutreachSettings();
    const dryRun = opts?.dryRun ?? !settings.enabled;
    const limit = opts?.limit ?? 25;

    const res: OutreachRunResult = { dryRun, scanned: 0, sent: 0, skipped: {}, failed: 0, details: [] };
    const bump = (k: string) => { res.skipped[k] = (res.skipped[k] || 0) + 1; };

    // Кандидаты: новые заказы в статусе pickup, за последние 2 дня (чтобы не гнать историю).
    const since = new Date(Date.now() - 2 * 24 * 3600 * 1000).toISOString();
    const { data: orders, error } = await supabase
        .from('orders')
        .select('order_id, number, status, manager_id, raw_payload, created_at')
        .eq('status', settings.pickup_status)
        .gte('created_at', since)
        .order('created_at', { ascending: true })
        .limit(limit);
    if (error) throw new Error(`orders query failed: ${error.message}`);

    // Уже обработанные (реально отправленные) — чтобы не слать повторно.
    const ids = (orders || []).map((o: any) => o.order_id);
    const seen = new Set<number>();
    if (ids.length) {
        const { data: logRows } = await supabase
            .from('rop_outreach_log')
            .select('order_id, outcome')
            .in('order_id', ids)
            .eq('outcome', 'sent');
        (logRows || []).forEach((r: any) => seen.add(Number(r.order_id)));
    }

    // Rate-cap: сколько живых писем уже ушло за последний час.
    let sentLastHour = 0;
    if (!dryRun) {
        const hourAgo = new Date(Date.now() - 3600 * 1000).toISOString();
        const { count } = await supabase
            .from('rop_outreach_log')
            .select('order_id', { count: 'exact', head: true })
            .eq('outcome', 'sent')
            .gte('updated_at', hourAgo);
        sentLastHour = count || 0;
    }

    for (const o of (orders || []) as OrderRow[]) {
        res.scanned++;
        const orderId = Number(o.order_id);
        if (seen.has(orderId)) { bump('already_sent'); continue; }

        const raw = o.raw_payload || {};

        if (settings.exclude_known_clients && isKnownClient(raw)) {
            await logOutcome(orderId, o.number, null, 'skipped_known', 'постоянный клиент', o.manager_id);
            bump('known_client');
            res.details.push({ order: orderId, outcome: 'skipped_known' });
            continue;
        }
        if (settings.require_legal_entity && !isLegalEntity(raw)) {
            bump('not_legal_entity');
            res.details.push({ order: orderId, outcome: 'skipped_not_legal' });
            continue;
        }

        const email = extractCustomerEmail(raw);
        if (!email) {
            await logOutcome(orderId, o.number, null, 'skipped_no_email', 'нет email у клиента', o.manager_id);
            bump('no_email');
            res.details.push({ order: orderId, outcome: 'skipped_no_email' });
            continue;
        }

        if (!dryRun && sentLastHour >= settings.rate_per_hour) {
            bump('rate_capped');
            res.details.push({ order: orderId, outcome: 'skipped_rate' });
            continue;
        }

        const firstName = extractFirstName(raw);

        if (dryRun) {
            await logOutcome(orderId, o.number, email, 'dry_run', 'сухой прогон (enabled=false)', o.manager_id);
            res.details.push({ order: orderId, outcome: 'dry_run', reason: email });
            continue;
        }

        // ── Живой режим ────────────────────────────────────────────────────
        try {
            // 1) Сначала шлём письмо-приглашение — чтобы при сбое отправки не осиротить
            //    заказ на боте.
            const { subjectText, html, fromName } = composeInviteEmail({
                orderId,
                number: o.number,
                firstName,
                siteBaseUrl: settings.site_base_url,
            });
            const sendResult = await sendOrderEmail({ to: email, orderNumber: o.number, subjectText, html, fromName });

            if (!sendResult.sent) {
                await logOutcome(orderId, o.number, email, 'failed', sendResult.error || 'send_failed', o.manager_id);
                res.failed++;
                res.details.push({ order: orderId, outcome: 'failed', reason: sendResult.error });
                continue;
            }

            // 2) Письмо ушло — переназначаем заказ на бота-квалификатора.
            await updateExistingOrderInCrm(orderId, { managerId: settings.bot_manager_id });

            const deadline = addBusinessHours(new Date(), settings.timeout_hours).toISOString();
            await logOutcome(orderId, o.number, email, 'sent', null, o.manager_id, deadline);
            sentLastHour++;
            res.sent++;
            res.details.push({ order: orderId, outcome: 'sent', reason: email });
        } catch (e: any) {
            await logOutcome(orderId, o.number, email, 'failed', e?.message || 'error', o.manager_id);
            res.failed++;
            res.details.push({ order: orderId, outcome: 'failed', reason: e?.message });
        }
    }

    return res;
}

/** Upsert строки лога по order_id (dry_run/skipped обновляемы, 'sent' не перетираем в проходе). */
async function logOutcome(
    orderId: number,
    number: string,
    emailTo: string | null,
    outcome: string,
    reason: string | null,
    originalManagerId: number | null,
    deadlineAt?: string,
) {
    await supabase.from('rop_outreach_log').upsert({
        order_id: orderId,
        order_number: number,
        email_to: emailTo,
        outcome,
        reason,
        original_manager_id: originalManagerId ?? null,
        deadline_at: deadlineAt ?? null,
        updated_at: new Date().toISOString(),
    }, { onConflict: 'order_id' });
}

export interface TimeoutRunResult {
    checked: number;
    returned: number;
    details: Array<{ order: number; managerId: number | null; reason: string }>;
}

/**
 * Возврат зависших заявок: приглашение отправлено, но клиент не прошёл квалификацию
 * за timeout_hours и заказ всё ещё на боте в статусе pickup — вернуть живому менеджеру.
 */
export async function runTimeoutReturns(opts?: { dryRun?: boolean }): Promise<TimeoutRunResult> {
    const settings = await getOutreachSettings();
    const dryRun = opts?.dryRun ?? !settings.enabled;
    const out: TimeoutRunResult = { checked: 0, returned: 0, details: [] };

    const { data: due } = await supabase
        .from('rop_outreach_log')
        .select('order_id, order_number, original_manager_id')
        .eq('outcome', 'sent')
        .is('returned_at', null)
        .lt('deadline_at', new Date().toISOString())
        .limit(50);
    if (!due?.length) return out;

    let ctx: any = null;
    for (const row of due) {
        out.checked++;
        const orderId = Number(row.order_id);

        // Текущее состояние заказа: ещё на боте и в статусе «новый»?
        const { data: ord } = await supabase
            .from('orders')
            .select('status, manager_id, raw_payload')
            .eq('order_id', orderId)
            .maybeSingle();

        // Клиент уже прошёл квалификацию (статус сменился) или заказ ушёл с бота — закрываем без возврата.
        if (!ord || ord.status !== settings.pickup_status || Number(ord.manager_id) !== settings.bot_manager_id) {
            await supabase.from('rop_outreach_log')
                .update({ returned_at: new Date().toISOString(), outcome: 'sent', reason: 'progressed_or_moved', updated_at: new Date().toISOString() })
                .eq('order_id', orderId);
            continue;
        }

        // Кому вернуть: исходный менеджер, иначе — по правилам назначения.
        let managerId: number | null = row.original_manager_id ? Number(row.original_manager_id) : null;
        if (!managerId) {
            if (!ctx) ctx = await getAssignmentContext();
            const email = extractCustomerEmail(ord.raw_payload || {});
            const a = await resolveAssignment(email || '', ctx);
            managerId = a.managerId;
        }

        if (dryRun) {
            out.details.push({ order: orderId, managerId, reason: 'dry_run_would_return' });
            continue;
        }

        try {
            if (managerId) {
                await updateExistingOrderInCrm(orderId, {
                    managerId,
                    noteText: `Автовозврат от бота-квалификатора: клиент не прошёл квалификацию за ${settings.timeout_hours} ч.`,
                });
            }
            await supabase.from('rop_outreach_log')
                .update({ returned_at: new Date().toISOString(), outcome: 'returned', updated_at: new Date().toISOString() })
                .eq('order_id', orderId);
            out.returned++;
            out.details.push({ order: orderId, managerId, reason: 'returned' });
        } catch (e: any) {
            out.details.push({ order: orderId, managerId, reason: `error: ${e?.message}` });
        }
    }

    return out;
}
