import { supabase } from '@/utils/supabase';
import { PRESALE_STATUSES, buildPlan, purchases } from '@/lib/sales-rop/rules';
import type { PresaleOrder, Task, Thresholds } from '@/lib/sales-rop/rules';
import { formatDiscipline, formatEvening, formatEveningHeader, formatMorning } from '@/lib/sales-rop/format';
import { updateExistingOrderInCrm } from '@/lib/retailcrm/leads';
import type { EveningRow } from '@/lib/sales-rop/format';

// Сборка и отправка утреннего плана и вечернего разбора.
//
// Чат и бот берутся те же, в которые уже уходят оплаты: отдел продаж живёт в
// одном чате, и заводить второй — верный способ, чтобы половину сообщений
// никто не читал.

const CRM_BASE = (process.env.NEXT_PUBLIC_RETAILCRM_URL || process.env.RETAILCRM_URL || '').replace(/\/$/, '');

export type Settings = Thresholds & {
    chatId: string;
    enabled: boolean;
    monthPlan: number;
    setCrmDate: boolean;
    /** Кого звать, когда менеджер заказа уволен или без ника. */
    orphanTelegram: string;
    devPerDay: number;
    devMinOrders: number;
    devMinDays: number;
    devMaxDays: number;
    disciplineDays: number;
    disciplineWarnPct: number;
    /** Конвейер: ночная парковка заявок в пул и выдача пачками. */
    queueEnabled: boolean;
    queuePoolManagerId: number;
    queueBatchSize: number;
    /** Кому включён конвейер. Пустой список — всем из плана. */
    queueManagerIds: number[];
};

export async function loadSettings(): Promise<Settings> {
    const { data, error } = await supabase.from('sales_rop_settings').select('key, value');
    if (error) throw new Error(error.message);
    const map = new Map((data ?? []).map((r: any) => [r.key, r.value]));
    const num = (key: string, fallback: number) => {
        const v = Number(map.get(key));
        return Number.isFinite(v) ? v : fallback;
    };

    return {
        // Пустая настройка означает «шли туда же, куда оплаты», а не «молчи»:
        // отдельный чат для плана продаж пока не нужен.
        chatId: String(map.get('telegram_chat_id') || process.env.TELEGRAM_PAYMENTS_CHAT_ID || ''),
        enabled: String(map.get('enabled') ?? 'true') === 'true',
        tasksPerManager: num('tasks_per_manager', 7),
        invoiceStaleDays: num('invoice_stale_days', 2),
        dealStaleDays: num('deal_stale_days', 3),
        bigDealAmount: num('big_deal_amount', 1_000_000),
        bigDealSilenceDays: num('big_deal_silence_days', 7),
        overdueLimitDays: num('overdue_limit_days', 90),
        lostPerDay: num('lost_per_day', 2),
        monthPlan: num('month_plan', 13_000_000),
        setCrmDate: String(map.get('set_crm_contact_date') ?? 'true') === 'true',
        orphanTelegram: String(map.get('orphan_telegram') || ''),
        devPerDay: num('dev_per_day', 2),
        devMinOrders: num('dev_min_orders', 2),
        devMinDays: num('dev_min_days', 30),
        devMaxDays: num('dev_max_days', 540),
        disciplineDays: num('discipline_days', 7),
        disciplineWarnPct: num('discipline_warn_pct', 80),
        queueEnabled: String(map.get('queue_enabled') ?? 'false') === 'true',
        queuePoolManagerId: num('queue_pool_manager_id', 102),
        queueBatchSize: num('queue_batch_size', 2),
        queueManagerIds: String(map.get('queue_manager_ids') || '')
            .split(',')
            .map((x) => Number(x.trim()))
            .filter((x) => Number.isFinite(x) && x > 0),
    };
}

/** Заказы, которые ещё могут стать деньгами. Мёртвые статусы сюда не попадают. */
export async function loadPresaleOrders(): Promise<
    Array<PresaleOrder & { managerName: string; telegram: string; site: string; managerActive: boolean }>
> {
    const { data, error } = await supabase.rpc('sales_rop_presale_orders');
    if (error) throw new Error(error.message);
    return (data ?? []).map((r: any) => ({
        orderId: Number(r.order_id),
        number: String(r.number ?? ''),
        client: r.client ?? '',
        statusCode: r.status_code,
        statusName: r.status_name ?? r.status_code,
        amount: Number(r.amount ?? 0),
        managerId: r.manager_id === null ? null : Number(r.manager_id),
        contactDate: r.contact_date,
        lastTouchAt: r.last_touch_at,
        managerName: r.manager_name || 'без менеджера',
        telegram: r.telegram_username || '',
        site: r.site || '',
        managerActive: Boolean(r.manager_active),
    }));
}

async function sendToChat(chatId: string, text: string): Promise<void> {
    const token = process.env.TELEGRAM_PAYMENTS_BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN;
    if (!token || !chatId) return;
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            chat_id: chatId,
            text,
            parse_mode: 'HTML',
            disable_web_page_preview: true,
        }),
    });
    if (!res.ok) throw new Error(`Telegram → ${res.status}: ${(await res.text()).slice(0, 200)}`);
}

/**
 * Задачи на развитие клиента: кому что ещё можно продать.
 *
 * Цель — 300 постоянных клиентов со средним чеком 3 млн в год, и достигается она
 * не потоком заявок, а базой: клиент, третий год берущий один и тот же шкаф, —
 * это недоработанный клиент, а не лояльный.
 *
 * Предлагаем только то, что в этой же сфере деятельности уже покупают другие:
 * назвать клиенту товар, которого мы не делаем, хуже, чем не позвонить.
 */
async function loadDevelopmentTasks(settings: Settings, plannedOrderIds: Set<number>): Promise<Task[]> {
    const { data, error } = await supabase.rpc('sales_dev_candidates', {
        p_min_orders: settings.devMinOrders,
        p_min_days_since: settings.devMinDays,
        p_max_days_since: settings.devMaxDays,
    });
    if (error) throw new Error(error.message);

    const byManager = new Map<number | null, Task[]>();
    const rows = ((data ?? []) as any[])
        .filter((r) => Array.isArray(r.suggest_categories) && r.suggest_categories.length > 0)
        .sort((a, b) => Number(b.total_amount) - Number(a.total_amount));

    for (const r of rows) {
        const managerId = r.manager_id === null ? null : Number(r.manager_id);
        const list = byManager.get(managerId) ?? [];
        if (list.length >= settings.devPerDay) continue;

        const orderId = Number(r.last_order_id);
        // Один заказ — одна строка в плане: если по нему уже есть срочная
        // задача, развитие подождёт до следующего дня.
        if (plannedOrderIds.has(orderId)) continue;

        const own = (r.own_categories ?? []).filter((c: string) => c !== 'Прочее' && c !== 'Доставка');
        list.push({
            orderId,
            number: String(r.last_order_number ?? ''),
            client: r.client_name ?? '',
            statusCode: 'development',
            statusName: 'Развитие',
            amount: Number(r.total_amount ?? 0),
            managerId,
            reasonCode: 'development',
            reasonText:
                `${purchases(Number(r.orders_count))} на ${Math.round(Number(r.total_amount)).toLocaleString('ru-RU')} ₽, ` +
                `последняя ${r.days_since} дн назад. Берёт: ${own.join(', ') || 'не разобрано'}. ` +
                `В сфере «${r.sphere_name}» такие клиенты берут ещё: ${(r.suggest_categories ?? []).join(', ')} — спросить, нужно ли`,
            weight: Number(r.total_amount ?? 0),
        });
        byManager.set(managerId, list);
    }

    return Array.from(byManager.values()).flat();
}

export type MorningResult = { date: string; managers: number; tasks: number; crmSet: number; sent: boolean };

/**
 * Ставит дату следующего контакта в карточке заказа.
 *
 * Пишем через тот же orders/edit, что и остальной проект: он единственный
 * доступен ключу и, главное, требует РЕАЛЬНЫЙ site заказа — при чужом site
 * RetailCRM отвечает «Not found», и запись молча не происходит.
 *
 * Ошибка одного заказа не должна отменять рассылку: план в чате полезен и без
 * записи в CRM, а провал виден в crm_error.
 */
async function setContactDate(orderId: number, site: string, date: string): Promise<{ ok: boolean; error?: string }> {
    try {
        const res = await updateExistingOrderInCrm(orderId, { customFields: { data_kontakta: date } }, site || undefined);
        return res.success ? { ok: true } : { ok: false, error: res.errorMsg || 'RetailCRM отказал' };
    } catch (e: any) {
        return { ok: false, error: e.message };
    }
}

export async function runMorning(today: string, opts: { dryRun?: boolean } = {}): Promise<MorningResult & { preview: string[] }> {
    const settings = await loadSettings();

    // Профили клиентов пересчитываются раз в сутки, здесь: разбор позиций всех
    // заказов за три года занимает минуты, и делать это на каждый запрос нельзя.
    if (!opts.dryRun) await supabase.rpc('sales_refresh_client_profiles').catch(() => null);

    const orders = await loadPresaleOrders();
    const plan = buildPlan(orders, today, settings);

    // Развитие добавляется после основного плана: сначала то, что горит.
    const plannedIds = new Set<number>();
    for (const [, tasks] of Array.from(plan.entries())) for (const t of tasks) plannedIds.add(t.orderId);
    for (const dev of await loadDevelopmentTasks(settings, plannedIds)) {
        const list = plan.get(dev.managerId) ?? [];
        list.push(dev);
        plan.set(dev.managerId, list);
    }

    const nameById = new Map<number | null, { name: string; tg: string }>();
    for (const o of orders) {
        // Уволенный менеджер или менеджер без ника: заказы у него настоящие, а
        // адресата нет. Такой блок уходит владельцу, иначе его не делает никто.
        const orphan = !o.managerActive || !o.telegram;
        nameById.set(o.managerId, {
            name: orphan ? `${o.managerName} (менеджер неактивен)` : o.managerName,
            tg: orphan ? settings.orphanTelegram : o.telegram,
        });
    }

    const preview: string[] = [];
    const rows: any[] = [];
    const planned: Task[] = [];

    // Группируем по адресату, а не по менеджеру: заказы пятерых уволенных
    // достаются одному человеку, и пять отдельных сообщений подряд с его тегом —
    // это способ добиться, чтобы их не читали.
    const byRecipient = new Map<string, { name: string; tg: string; tasks: Task[]; managerId: number | null }>();
    for (const [managerId, tasks] of Array.from(plan.entries())) {
        if (tasks.length === 0) continue;
        const who = nameById.get(managerId) ?? { name: 'без менеджера', tg: '' };
        const key = who.tg || who.name;
        const bucket = byRecipient.get(key) ?? { name: who.name, tg: who.tg, tasks: [], managerId };
        bucket.tasks.push(...tasks);
        byRecipient.set(key, bucket);
    }

    for (const bucket of Array.from(byRecipient.values())) {
        preview.push(
            formatMorning(
                { managerId: bucket.managerId, managerName: bucket.name, telegramUsername: bucket.tg, tasks: bucket.tasks },
                CRM_BASE,
            ),
        );
        for (const t of bucket.tasks) {
            rows.push(taskRow(today, t));
            planned.push(t);
        }
    }

    if (!opts.dryRun && rows.length > 0) {
        // Сохраняем ДО отправки: вечером сверяется то, что просили утром, а не
        // то, что подошло бы под правило вечером.
        const { error } = await supabase.from('sales_rop_task').upsert(rows, { onConflict: 'plan_date,order_id' });
        if (error) throw new Error(error.message);
    }

    // Дата следующего контакта в карточке заказа. План должен всплыть у
    // менеджера на его рабочем экране в RetailCRM, а не только в чате: в чат
    // заглядывают, а в CRM работают.
    let crmSet = 0;
    if (!opts.dryRun && settings.setCrmDate) {
        const siteById = new Map(orders.map((o) => [o.orderId, o.site]));
        for (const t of planned) {
            // Тем, у кого контакт и так назначен на сегодня, писать нечего.
            if (t.reasonCode === 'contact_today') continue;
            const res = await setContactDate(t.orderId, siteById.get(t.orderId) || '', today);
            if (res.ok) crmSet += 1;
            await supabase
                .from('sales_rop_task')
                .update({ crm_date_set: res.ok, crm_error: res.error ?? null })
                .eq('plan_date', today)
                .eq('order_id', t.orderId);
        }
    }

    let sent = false;
    if (!opts.dryRun && settings.enabled && settings.chatId) {
        for (const text of preview) await sendToChat(settings.chatId, text);
        sent = preview.length > 0;
    }

    return { date: today, managers: preview.length, tasks: rows.length, crmSet, sent, preview };
}

function taskRow(date: string, t: Task) {
    return {
        plan_date: date,
        manager_id: t.managerId,
        order_id: t.orderId,
        order_number: t.number,
        client: t.client,
        status_code: t.statusCode,
        status_name: t.statusName,
        amount: t.amount,
        reason_code: t.reasonCode,
        reason_text: t.reasonText,
        weight: t.weight,
    };
}

/**
 * Касание — любой след работы по заказу за день: комментарий менеджера, смена
 * статуса, перенос даты контакта, звонок или письмо. Специально широко: цель
 * не поймать за руку, а увидеть, что заказом занимались.
 */
export async function detectTouches(date: string): Promise<Map<number, string>> {
    const { data, error } = await supabase.rpc('sales_rop_touches', { p_date: date });
    if (error) throw new Error(error.message);
    return new Map((data ?? []).map((r: any) => [Number(r.order_id), String(r.touch_kind)]));
}

export type EveningResult = { date: string; checked: number; touched: number; sent: boolean; preview: string[] };

export async function runEvening(today: string, opts: { dryRun?: boolean } = {}): Promise<EveningResult> {
    const settings = await loadSettings();

    const { data: tasks, error } = await supabase
        .from('sales_rop_task')
        .select('*')
        .eq('plan_date', today);
    if (error) throw new Error(error.message);
    if ((tasks ?? []).length === 0) {
        return { date: today, checked: 0, touched: 0, sent: false, preview: [] };
    }

    const touches = await detectTouches(today);
    const orders = await loadPresaleOrders();
    const who = new Map<number | null, { name: string; tg: string }>();
    for (const o of orders) who.set(o.managerId, { name: o.managerName, tg: o.telegram });

    const byManager = new Map<number | null, EveningRow[]>();
    let touchedCount = 0;

    for (const t of tasks as any[]) {
        const kind = touches.get(Number(t.order_id)) ?? null;
        if (kind) touchedCount += 1;
        const row: EveningRow = {
            orderId: Number(t.order_id),
            number: t.order_number,
            client: t.client,
            statusCode: t.status_code,
            statusName: t.status_name,
            amount: Number(t.amount),
            managerId: t.manager_id === null ? null : Number(t.manager_id),
            reasonCode: t.reason_code,
            reasonText: t.reason_text,
            weight: Number(t.weight),
            touched: Boolean(kind),
            touchKind: kind,
        };
        const list = byManager.get(row.managerId) ?? [];
        list.push(row);
        byManager.set(row.managerId, list);
    }

    if (!opts.dryRun) {
        for (const [, rows] of Array.from(byManager.entries())) {
            for (const r of rows) {
                await supabase
                    .from('sales_rop_task')
                    .update({ touched: r.touched, touch_kind: r.touchKind, checked_at: new Date().toISOString() })
                    .eq('plan_date', today)
                    .eq('order_id', r.orderId);
            }
        }
    }

    const facts = await dayFacts(today, settings.monthPlan);
    const preview = [facts];
    for (const [managerId, rows] of Array.from(byManager.entries())) {
        const w = who.get(managerId) ?? { name: 'без менеджера', tg: '' };
        preview.push(formatEvening({ managerName: w.name, telegramUsername: w.tg, rows }, CRM_BASE));
    }

    // Дисциплина печатается каждый вечер: показатель, который видят раз в
    // неделю, ни на что не влияет — а этот прямо определяет, сколько заявок
    // человек получит завтра.
    {
        const { data: disc } = await supabase.rpc('sales_rop_discipline', { p_days: settings.disciplineDays });
        const rows = ((disc ?? []) as any[]).map((r) => {
            const w = who.get(r.manager_id === null ? null : Number(r.manager_id));
            return {
                managerName: r.manager_name || w?.name || 'без менеджера',
                telegramUsername: w?.tg || '',
                tasksTotal: Number(r.tasks_total),
                tasksTouched: Number(r.tasks_touched),
                donePct: Number(r.done_pct ?? 0),
                amountUntouched: Number(r.amount_untouched ?? 0),
            };
        });
        const text = formatDiscipline(rows, settings.disciplineWarnPct, settings.disciplineDays);
        if (text) preview.push(text);
    }

    let sent = false;
    if (!opts.dryRun && settings.enabled && settings.chatId) {
        await sendToChat(settings.chatId, preview.join('\n\n'));
        sent = true;
    }

    return { date: today, checked: (tasks as any[]).length, touched: touchedCount, sent, preview };
}

/** Цифры дня: счета, продажи, где месяц относительно плана. */
async function dayFacts(today: string, monthPlan: number): Promise<string> {
    const { data, error } = await supabase.rpc('sales_rop_day_facts', { p_date: today });
    if (error) throw new Error(error.message);
    const f = (data ?? [])[0] ?? {};

    const date = new Date(today);
    const last = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0));
    let workdaysLeft = 0;
    for (let d = date.getUTCDate() + 1; d <= last.getUTCDate(); d += 1) {
        const wd = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), d)).getUTCDay();
        if (wd !== 0 && wd !== 6) workdaysLeft += 1;
    }

    return formatEveningHeader({
        date: new Date(today).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' }),
        invoicesToday: Number(f.invoices_count ?? 0),
        invoicesSum: Number(f.invoices_sum ?? 0),
        soldToday: Number(f.sold_count ?? 0),
        soldSum: Number(f.sold_sum ?? 0),
        monthSold: Number(f.month_sold ?? 0),
        monthPlan,
        workdaysLeft,
    });
}
