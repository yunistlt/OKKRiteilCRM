/**
 * Факт месяца по менеджерам — ОДНО место, откуда его берут все экраны.
 *
 * Правило расчёта денег живёт в движке зарплаты (`computeOrderFinance` в
 * `lib/salary/metrics.ts`): он знает НДС по витрине, скидку на заказ целиком и
 * исключения (дубли, сметы, «не наша продукция»). Движок считается по
 * расписанию (`/api/cron/salary-recalc`) и кнопкой на /salary, а результат
 * лежит снимком в `salary_calc`.
 *
 * Экраны ничего не пересчитывают: «Мой день» и бот-РОП читают этот снимок.
 * До 26.10.2026 у них была своя формула в SQL (`salary_revenue_no_vat`), и она
 * отстала от зарплатной — у Матвеевой за октябрь «Мой день» показывал
 * 3 761 163 ₽ против 3 456 289 ₽ в ведомости: SQL не вычитал скидку на заказ
 * целиком. Вторая формула удалена, чтобы цифры не могли разойтись снова.
 */
import { supabase } from '@/utils/supabase';
import type { CountedOrderBrief } from './engine';
import { computeOrderFinance, resolveVatPct } from './metrics';
import { getConfigForPeriod } from './config';

export type ManagerMonthFact = {
    managerId: number;
    /** Выручка без НДС по засчитанным заказам месяца. */
    revenueNoVat: number;
    /** Сколько заказов засчитано (ушли в производство в этом месяце). */
    ordersCount: number;
    orders: CountedOrderBrief[];
};

export type MonthFacts = {
    /** Когда движок считал этот снимок. Экран показывает дату — цифра не живая. */
    computedAt: string | null;
    byManager: Map<number, ManagerMonthFact>;
};

const EMPTY: MonthFacts = { computedAt: null, byManager: new Map() };

/** Снимок факта месяца по всем менеджерам. Ничего не считает — только читает. */
export async function loadMonthFacts(year: number, month: number): Promise<MonthFacts> {
    const { data: period } = await supabase
        .from('salary_period')
        .select('id')
        .eq('year', year)
        .eq('month', month)
        .maybeSingle();

    const periodId = Number((period as any)?.id ?? 0);
    if (!periodId) return EMPTY;

    const { data: rows } = await supabase
        .from('salary_calc')
        .select('manager_id, breakdown, computed_at')
        .eq('period_id', periodId);

    const byManager = new Map<number, ManagerMonthFact>();
    let computedAt: string | null = null;

    for (const row of ((rows as any[]) ?? [])) {
        const orders: CountedOrderBrief[] = Array.isArray(row?.breakdown?.countedOrders)
            ? row.breakdown.countedOrders
            : [];
        byManager.set(Number(row.manager_id), {
            managerId: Number(row.manager_id),
            revenueNoVat: orders.reduce((s, o) => s + (Number(o.revenueNoVat) || 0), 0),
            ordersCount: orders.length,
            orders,
        });
        const at = row?.computed_at ? String(row.computed_at) : null;
        if (at && (!computedAt || at > computedAt)) computedAt = at;
    }

    return { computedAt, byManager };
}

/** Факт месяца одного менеджера. Нет снимка — нули, а не «посчитаем сами». */
export async function loadManagerMonthFact(
    managerId: number,
    year: number,
    month: number,
): Promise<ManagerMonthFact & { computedAt: string | null }> {
    const facts = await loadMonthFacts(year, month);
    const mine = facts.byManager.get(managerId);
    return {
        managerId,
        revenueNoVat: mine?.revenueNoVat ?? 0,
        ordersCount: mine?.ordersCount ?? 0,
        orders: mine?.orders ?? [],
        computedAt: facts.computedAt,
    };
}

/**
 * Выручка без НДС по списку заказов — ТЕМ ЖЕ правилом, что и в ведомости.
 *
 * Нужна там, где снимка месяца не хватает: вечерний отчёт бота считает ещё и
 * счета дня (вход в «Предоплату»), а в зарплатный снимок попадают только
 * заказы, ушедшие в производство. Отдельной формулы здесь нет — зовём
 * `computeOrderFinance` движка ЗП.
 */
export async function revenueNoVatForOrders(orderIds: number[], asOf: Date): Promise<number> {
    if (!orderIds.length) return 0;

    const config = await getConfigForPeriod(asOf.getFullYear(), asOf.getMonth() + 1);

    const { data: rows } = await supabase
        .from('orders')
        .select('order_id, site, totalsumm, raw_payload')
        .in('order_id', orderIds);

    let sum = 0;
    for (const row of ((rows as any[]) ?? [])) {
        const payload = row?.raw_payload ?? {};
        const vatPct = resolveVatPct(row?.site ?? null, config.vat_policy, payload?.contragent ?? null);
        const fin = computeOrderFinance(
            payload?.items ?? [],
            vatPct,
            config.nds_normalization.rules,
            row?.totalsumm,
        );
        sum += fin.revenueNoVat;
    }
    return sum;
}
