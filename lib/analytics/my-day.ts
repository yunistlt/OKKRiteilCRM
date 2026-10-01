/**
 * Рабочий день менеджера: что делать сейчас и что следующим.
 *
 * Главная беда менеджера — не нехватка данных, а расфокусировка: заявки,
 * сделки, звонки и обещания лежат в разных списках, и он тратит силы на выбор,
 * за что взяться. Экран отвечает на один вопрос — «что сделать сейчас, чтобы
 * ближе всего подойти к продаже» (требование владельца 01.10.2026).
 *
 * Своих сущностей не заводим: очередь собирается из того, что уже есть —
 * плана дня бота-РОПа (`sales_rop_task`), заказов и их полей. Ничего не
 * пишем, всё считается на лету.
 */
import { supabase } from '@/utils/supabase';
import { CUSTOM_FIELD_CODES } from '@/lib/orders-filter';

/** Сколько минут даётся на ответ новому лиду, прежде чем он станет горящим. */
const LEAD_SLA_MINUTES = 30;

/** Через сколько дней молчания сделка считается зависшей. */
const STALE_DAYS = 5;

export type ActionKind = 'lead' | 'promise' | 'plan' | 'stale';

export type NextAction = {
    orderId: number;
    orderNumber: string;
    client: string;
    amount: number;
    statusName: string;
    /** Что делать — одним глаголом, как на кнопке. */
    action: string;
    /** Почему это сейчас: факт из заказа, а не догадка. */
    reason: string;
    /** Совет ИИ по этому заказу: что сделать, почему и о чём спросить. */
    advice: { action: string; why: string | null; offer: string | null } | null;
    kind: ActionKind;
    /** Чем выше, тем раньше в очереди. */
    weight: number;
    /** Сколько минут осталось по SLA, если это новый лид. */
    slaLeftMinutes: number | null;
    done: boolean;
};

export type MyDay = {
    date: string;
    managerId: number | null;
    now: NextAction | null;
    next: NextAction[];
    all: NextAction[];
    counts: { urgent: number; next: number; planned: number; total: number; done: number };
    plan: { target: number; fact: number; forecast: number; factPct: number; forecastPct: number; workdaysLeft: number; perDay: number };
    funnel: Array<{ name: string; color: string | null; count: number; amount: number }>;
    metrics: { callsToday: number; talksToday: number; ordersMonth: number; revenueMonth: number };
};

const money = (value: unknown) => Number(value ?? 0) || 0;

/**
 * Вес действия.
 *
 * По просьбе владельца приоритет считается не временем создания, а деньгами и
 * срочностью: «позвонить по сделке на 730 000 ₽, где клиент решает сегодня»
 * должно стоять выше очередного холодного звонка.
 */
function weigh(params: { amount: number; kind: ActionKind; slaLeftMinutes: number | null; daysSilent: number }): number {
    // Деньги — основа веса, но логарифмом: сделка на 10 млн важнее сделки на
    // 100 тысяч, но не в сто раз, иначе мелкие задачи не будут делаться никогда.
    const moneyWeight = Math.log10(Math.max(params.amount, 1) + 1) * 10;

    const kindWeight =
        params.kind === 'lead' ? 60 : params.kind === 'promise' ? 50 : params.kind === 'stale' ? 20 : 30;

    // Горящий лид: чем меньше осталось до конца SLA, тем выше.
    const slaWeight =
        params.slaLeftMinutes === null ? 0 : Math.max(0, (LEAD_SLA_MINUTES - params.slaLeftMinutes) * 2);

    // Молчание копит вес, но не бесконечно: через месяц заказ не становится
    // важнее сегодняшнего обещания клиенту.
    const silenceWeight = Math.min(params.daysSilent, 30);

    return Math.round(moneyWeight + kindWeight + slaWeight + silenceWeight);
}

function daysBetween(from: string | null | undefined, to = new Date()): number {
    if (!from) return 0;
    const start = new Date(from).getTime();
    if (!Number.isFinite(start)) return 0;
    return Math.max(0, Math.floor((to.getTime() - start) / 86400000));
}

/** Рабочих дней в месяце и сколько осталось, считая сегодня. */
function workdays(today: Date): { total: number; left: number; passed: number } {
    const year = today.getFullYear();
    const month = today.getMonth();
    const last = new Date(year, month + 1, 0).getDate();

    let total = 0;
    let left = 0;
    for (let day = 1; day <= last; day += 1) {
        const weekday = new Date(year, month, day).getDay();
        if (weekday === 0 || weekday === 6) continue;
        total += 1;
        if (day >= today.getDate()) left += 1;
    }

    return { total, left, passed: Math.max(1, total - left + 1) };
}

/** План, факт и прогноз месяца — из настроек мотивации, как у зарплаты и бота. */
async function loadPlan(managerId: number, today: Date) {
    const { data: planRow } = await supabase
        .from('salary_plan')
        .select('target')
        .eq('year', today.getFullYear())
        .eq('month', today.getMonth() + 1)
        .eq('metric', 'revenue_no_vat')
        .eq('manager_id', managerId)
        .maybeSingle();

    const target = money((planRow as any)?.target);

    const { data: factRows } = await supabase.rpc('sales_rop_month_by_manager', {
        p_date: today.toISOString().slice(0, 10),
    });

    const fact = money(
        ((factRows ?? []) as any[]).find((r) => Number(r.manager_id) === managerId)?.sold_sum,
    );

    const { total, left, passed } = workdays(today);
    // Прогноз — текущий темп до конца месяца. Это не обещание, а продолжение
    // того, что уже сделано: по нему видно, хватит ли темпа.
    const forecast = Math.round((fact / passed) * total);

    return {
        target,
        fact,
        forecast,
        factPct: target > 0 ? Math.round((fact / target) * 100) : 0,
        forecastPct: target > 0 ? Math.round((forecast / target) * 100) : 0,
        workdaysLeft: left,
        perDay: left > 0 ? Math.max(0, Math.round((target - fact) / left)) : 0,
    };
}

/** Воронка месяца по этапам — те же этапы, что на доске статусов. */
async function loadFunnel(managerId: number, today: Date) {
    const monthStart = new Date(today.getFullYear(), today.getMonth(), 1).toISOString().slice(0, 10);

    const [{ data: orders }, { data: statuses }, { data: groups }] = await Promise.all([
        supabase
            .from('orders')
            .select('status, totalsumm')
            .eq('manager_id', managerId)
            .is('crm_deleted_at', null)
            .gte('created_at', monthStart)
            .limit(5000),
        supabase.from('crm_statuses').select('external_code, group_id'),
        supabase.from('crm_status_groups').select('id, name, color, ordering'),
    ]);

    const groupById = new Map(((groups ?? []) as any[]).map((g) => [String(g.id), g]));
    const groupOfStatus = new Map(
        ((statuses ?? []) as any[])
            .filter((s) => s.external_code && s.group_id)
            .map((s) => [String(s.external_code), String(s.group_id)]),
    );

    const totals = new Map<string, { count: number; amount: number }>();
    for (const order of ((orders ?? []) as any[])) {
        const groupId = groupOfStatus.get(String(order.status));
        if (!groupId) continue;
        const current = totals.get(groupId) ?? { count: 0, amount: 0 };
        current.count += 1;
        current.amount += money(order.totalsumm);
        totals.set(groupId, current);
    }

    return Array.from(totals.entries())
        .map(([groupId, value]) => ({
            name: String(groupById.get(groupId)?.name ?? 'Без этапа'),
            color: (groupById.get(groupId)?.color ?? null) as string | null,
            ordering: Number(groupById.get(groupId)?.ordering ?? 999),
            count: value.count,
            amount: value.amount,
        }))
        .sort((a, b) => a.ordering - b.ordering)
        .map(({ ordering, ...rest }) => rest);
}

/** Сегодняшние звонки менеджера — из того же источника, что и отчёты: RetailCRM. */
async function loadMetrics(managerId: number, today: Date) {
    const dayStart = `${today.toISOString().slice(0, 10)}T00:00:00`;
    const monthStart = new Date(today.getFullYear(), today.getMonth(), 1).toISOString().slice(0, 10);

    const [{ data: calls }, { count: ordersMonth }] = await Promise.all([
        supabase
            .from('retailcrm_calls')
            .select('duration_sec, is_missed')
            .eq('manager_rc_id', String(managerId))
            .gte('call_date', dayStart)
            .limit(500),
        supabase
            .from('orders')
            .select('order_id', { count: 'exact', head: true })
            .eq('manager_id', managerId)
            .is('crm_deleted_at', null)
            .gte('created_at', monthStart),
    ]);

    const rows = (calls ?? []) as any[];

    return {
        callsToday: rows.length,
        // Разговором считаем состоявшийся звонок: гудки работой не являются.
        talksToday: rows.filter((c) => !c.is_missed && Number(c.duration_sec ?? 0) >= 20).length,
        ordersMonth: Number(ordersMonth ?? 0),
        revenueMonth: 0,
    };
}

/**
 * Очередь действий.
 *
 * Берём план дня бота (он уже отобрал заказы и объяснил причину), добавляем
 * новые заявки с горящим SLA и зависшие сделки, после чего выстраиваем всё по
 * весу. Менеджер очередь не составляет — её составляет система.
 */
async function loadQueue(managerId: number, today: Date): Promise<NextAction[]> {
    const date = today.toISOString().slice(0, 10);
    const actions: NextAction[] = [];
    const seen = new Set<number>();

    const { data: tasks } = await supabase
        .from('sales_rop_task')
        .select('order_id, order_number, client, amount, reason_text, reason_code, status_name, touched, touch_kind')
        .eq('plan_date', date)
        .eq('manager_id', managerId);

    // Советы ИИ по тем же заказам: «что сделать / почему / о чём спросить».
    // Их пишет бот-РОП, и в плане дня человек читает те же слова, что в чате.
    const taskOrderIds = ((tasks ?? []) as any[]).map((t) => Number(t.order_id)).filter(Boolean);
    const adviceByOrder = new Map<string, { action: string; why: string | null; offer: string | null }>();

    if (taskOrderIds.length) {
        const { data: advices } = await supabase
            .from('sales_task_advice')
            .select('order_id, reason_code, action, why, offer')
            .in('order_id', taskOrderIds);

        for (const row of ((advices ?? []) as any[])) {
            if (!row.action) continue;
            adviceByOrder.set(`${Number(row.order_id)}:${row.reason_code}`, {
                action: String(row.action),
                why: row.why ? String(row.why) : null,
                offer: row.offer ? String(row.offer) : null,
            });
        }
    }

    for (const row of ((tasks ?? []) as any[])) {
        const orderId = Number(row.order_id);
        seen.add(orderId);

        const promise = String(row.reason_code ?? '') === 'contact_today';
        actions.push({
            orderId,
            orderNumber: String(row.order_number ?? ''),
            client: row.client || 'Покупатель не указан',
            amount: money(row.amount),
            statusName: row.status_name || '',
            action: promise ? 'Позвонить' : 'Связаться',
            reason: row.reason_text || '',
            kind: promise ? 'promise' : 'plan',
            weight: weigh({ amount: money(row.amount), kind: promise ? 'promise' : 'plan', slaLeftMinutes: null, daysSilent: 0 }),
            slaLeftMinutes: null,
            advice: adviceByOrder.get(`${orderId}:${row.reason_code}`) ?? null,
            done: row.touched === true,
        });
    }

    // Новые заявки: пока по ним не ответили, время идёт — это самое срочное.
    const { data: leads } = await supabase
        .from('orders')
        .select('order_id, number, created_at, totalsumm, status, raw_payload')
        .eq('manager_id', managerId)
        .is('crm_deleted_at', null)
        .in('status', ['novyi-1', 'zapros-kontaktov'])
        .gte('created_at', `${date}T00:00:00`)
        .order('created_at', { ascending: false })
        .limit(50);

    for (const row of ((leads ?? []) as any[])) {
        const orderId = Number(row.order_id);
        if (seen.has(orderId)) continue;
        seen.add(orderId);

        const minutes = Math.floor((today.getTime() - new Date(row.created_at).getTime()) / 60000);
        const left = LEAD_SLA_MINUTES - minutes;
        const payload = row.raw_payload ?? {};

        actions.push({
            orderId,
            orderNumber: String(row.number ?? orderId),
            client: payload?.contragent?.legalName || payload?.customer?.nickName || payload?.firstName || 'Покупатель не указан',
            amount: money(row.totalsumm),
            statusName: 'Новая заявка',
            action: 'Взять в работу',
            reason: left > 0
                ? `Заявка поступила ${minutes} мин назад, ответить осталось ${left} мин`
                : `Заявка поступила ${minutes} мин назад — срок ответа вышел`,
            kind: 'lead',
            weight: weigh({ amount: money(row.totalsumm), kind: 'lead', slaLeftMinutes: left, daysSilent: 0 }),
            slaLeftMinutes: left,
            advice: null,
            done: false,
        });
    }

    // Зависшие деньги: сделка в работе, а движения нет. Отдельной аналитики для
    // этого не нужно — это такие же действия в общей очереди.
    const { data: stale } = await supabase
        .from('orders')
        .select('order_id, number, totalsumm, status, status_since, raw_payload')
        .eq('manager_id', managerId)
        .is('crm_deleted_at', null)
        .in('status', ['v-proscete', 'na-soglasovanii', 'raschet', 'ozidanie-tz'])
        .lt('status_since', new Date(today.getTime() - STALE_DAYS * 86400000).toISOString())
        .order('totalsumm', { ascending: false })
        .limit(50);

    for (const row of ((stale ?? []) as any[])) {
        const orderId = Number(row.order_id);
        if (seen.has(orderId)) continue;
        seen.add(orderId);

        const silent = daysBetween(row.status_since, today);
        const payload = row.raw_payload ?? {};

        actions.push({
            orderId,
            orderNumber: String(row.number ?? orderId),
            client: payload?.contragent?.legalName || payload?.customer?.nickName || payload?.firstName || 'Покупатель не указан',
            amount: money(row.totalsumm),
            statusName: payload?.status ?? '',
            action: 'Связаться',
            reason: `Нет движения ${silent} дн.`,
            kind: 'stale',
            weight: weigh({ amount: money(row.totalsumm), kind: 'stale', slaLeftMinutes: null, daysSilent: silent }),
            slaLeftMinutes: null,
            advice: null,
            done: false,
        });
    }

    return actions.sort((a, b) => Number(a.done) - Number(b.done) || b.weight - a.weight);
}

export async function loadMyDay(managerId: number | null, today = new Date()): Promise<MyDay> {
    const date = today.toISOString().slice(0, 10);

    if (!managerId) {
        return {
            date,
            managerId: null,
            now: null,
            next: [],
            all: [],
            counts: { urgent: 0, next: 0, planned: 0, total: 0, done: 0 },
            plan: { target: 0, fact: 0, forecast: 0, factPct: 0, forecastPct: 0, workdaysLeft: 0, perDay: 0 },
            funnel: [],
            metrics: { callsToday: 0, talksToday: 0, ordersMonth: 0, revenueMonth: 0 },
        };
    }

    const [queue, plan, funnel, metrics] = await Promise.all([
        loadQueue(managerId, today),
        loadPlan(managerId, today),
        loadFunnel(managerId, today),
        loadMetrics(managerId, today),
    ]);

    const open = queue.filter((a) => !a.done);

    return {
        date,
        managerId,
        now: open[0] ?? null,
        next: open.slice(1, 5),
        all: queue,
        counts: {
            // Срочное — то, что нельзя потерять сегодня: горящие заявки и обещания.
            urgent: open.filter((a) => a.kind === 'lead' || a.kind === 'promise').length,
            next: open.filter((a) => a.kind === 'plan').length,
            planned: open.filter((a) => a.kind === 'stale').length,
            total: queue.length,
            done: queue.filter((a) => a.done).length,
        },
        plan: { ...plan },
        funnel,
        metrics: { ...metrics, revenueMonth: plan.fact },
    };
}

export { LEAD_SLA_MINUTES, STALE_DAYS, CUSTOM_FIELD_CODES };
