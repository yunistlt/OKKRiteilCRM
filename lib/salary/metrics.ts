import { supabase } from '@/utils/supabase';
import { getConfigForPeriod, type SalaryConfig } from '@/lib/salary/config';

// ============================================================================
// Слой сбора расчётных метрик ЗП за период. Реляционная часть — в RPC
// (salary_counted_orders / salary_client_deal_counts / salary_incoming_counts),
// парсинг raw_payload и применение конфига — здесь. Метрики возвращают СЫРЫЕ
// числа; перевод в деньги (тиры, формула) — в движке (lib/salary/engine.ts).
// ============================================================================

export type OrderType = 'new' | 'permanent';

export interface CountedOrderRow {
    order_id: number;
    manager_id: number | null;
    client_id: number | null;
    client_name: string | null;
    entered_at: string;
    totalsumm: number | null;
    order_method: string | null;
    typ_castomer: string | null;
    created_at: string;
    items: any[] | null;
}

export interface OrderFinance {
    goodsBase: number; // стоимость товаров до скидки = Σ initialPrice × qty
    discountAmount: number; // Σ discountTotal по позициям
    discountPct: number; // discountAmount / goodsBase × 100
    revenueNoVat: number; // Σ price×qty, приведённая к «без НДС»
    margin: number; // Σ (price − purchasePrice) × qty (аналитика)
}

export interface CountedOrder extends OrderFinance {
    orderId: number;
    managerId: number | null;
    clientId: number | null;
    clientName: string | null; // имя клиента из CRM (компания/ФИО), для отчёта
    deals: number; // сколько закрытых сделок у клиента за всё время (основа типа новый/постоянный)
    type: OrderType;
    category: string | null; // категория товара заказа (orders.customFields.typ_castomer), для блоков «по категориям»
    enteredAt: string;
    createdAt: string; // дата обращения (создания заказа) — для блока «продажа в день обращения»
    totalsumm: number; // сумма заказа (raw_payload/orders.totalsumm), для отчёта по менеджеру
}

export interface ManagerMetrics {
    managerId: number;
    countedOrders: CountedOrder[];
    countsByType: Record<OrderType, number>;
    countsByCategory: Record<string, number>; // кол-во засчитанных заявок по категории товара (typ_castomer)
    revenueByCategory: Record<string, number>; // выручка без НДС по категории товара
    discountMetricValue: number | null; // значение метрики скидочной дисциплины
    qualityAvgScore: number | null; // AVG(total_score) 0–100, null если нет оценок
    qualityScriptPct: number | null; // AVG(script_score_pct), null если нет оценок
    fastContactShare: number | null; // доля заказов «в работе < 1 дня», %, null если нет оценок
    fieldsFilledShare: number | null; // доля заказов с полученным ТЗ, %, null если нет оценок
    conversion: { numerator: number; denominator: number; pct: number; eligible: boolean };
    dutyShifts: number;
    workedDays: number | null; // отработанные дни (для пропорции оклада); null = полный месяц
    marginTotal: number;
}

export interface PeriodMetrics {
    year: number;
    month: number;
    teamRevenueNoVat: number;
    managers: ManagerMetrics[];
}

// ── Чистые помощники (тестируются на реальных строках) ───────────────────────

/** Делитель НДС по ставке позиции из конфига; для none/null/неизвестного → 1. */
export function vatDivisor(vatRate: unknown, ndsRules: SalaryConfig['nds_normalization']['rules']): number {
    const num = typeof vatRate === 'number' ? vatRate : parseFloat(String(vatRate ?? ''));
    if (!Number.isFinite(num)) return 1;
    const rule = ndsRules.find((r) => r.vat_pct === num);
    return rule ? rule.divisor : 1;
}

/** Финансовые показатели заказа из его позиций (raw_payload.items). */
export function computeOrderFinance(
    items: any[] | null,
    ndsRules: SalaryConfig['nds_normalization']['rules'],
): OrderFinance {
    let goodsBase = 0;
    let discountAmount = 0;
    let revenueNoVat = 0;
    let margin = 0;

    for (const it of items ?? []) {
        const qty = Number(it?.quantity ?? 1) || 0;
        const initialPrice = Number(it?.initialPrice ?? 0) || 0;
        const price = Number(it?.prices?.[0]?.price ?? it?.initialPrice ?? 0) || 0;
        const discountTotal = Number(it?.discountTotal ?? 0) || 0;
        const purchasePrice = Number(it?.purchasePrice ?? 0) || 0;
        const divisor = vatDivisor(it?.vatRate, ndsRules);

        goodsBase += initialPrice * qty;
        discountAmount += discountTotal;
        revenueNoVat += (price * qty) / divisor;
        margin += (price - purchasePrice) * qty;
    }

    const discountPct = goodsBase > 0 ? (discountAmount / goodsBase) * 100 : 0;
    return { goodsBase, discountAmount, discountPct, revenueNoVat, margin };
}

/** Тип заявки по истории клиента: новый / постоянный. Категория товара — отдельно
 *  (countsByCategory), премия за категории — добавочный блок premia_categorii. */
export function classifyOrderType(
    clientId: number | null,
    clientDeals: Map<number, number>,
    config: SalaryConfig,
): OrderType {
    const deals = clientId != null ? clientDeals.get(clientId) ?? 0 : 0;
    return deals > config.permanent_client_threshold ? 'permanent' : 'new';
}

/** Сборка метрик из уже загруженных сырых данных (без обращений к БД — тестируемо). */
export function buildPeriodMetrics(input: {
    year: number;
    month: number;
    rows: CountedOrderRow[];
    clientDeals: Map<number, number>;
    incomingByManager: Map<number, number>;
    qualityByManager: Map<number, number>;
    scriptByManager?: Map<number, number>;
    fastContactByManager?: Map<number, number>;
    fieldsByManager?: Map<number, number>;
    dutyByManager: Map<number, number>;
    workedDaysByManager?: Map<number, number>;
    config: SalaryConfig;
}): PeriodMetrics {
    const { year, month, rows, clientDeals, incomingByManager, qualityByManager, dutyByManager, config } = input;
    const workedDaysByManager = input.workedDaysByManager ?? new Map<number, number>();
    const scriptByManager = input.scriptByManager ?? new Map<number, number>();
    const fastContactByManager = input.fastContactByManager ?? new Map<number, number>();
    const fieldsByManager = input.fieldsByManager ?? new Map<number, number>();

    const byManager = new Map<number, CountedOrder[]>();
    let teamRevenueNoVat = 0;

    for (const row of rows) {
        // bigint из БД может прийти строкой — нормализуем, иначе ключи Map не схлопываются
        const managerId = row.manager_id == null ? null : Number(row.manager_id);
        if (managerId == null || !Number.isFinite(managerId)) continue;
        const clientId = row.client_id == null ? null : Number(row.client_id);
        const fin = computeOrderFinance(row.items, config.nds_normalization.rules);
        const deals = clientId != null ? clientDeals.get(clientId) ?? 0 : 0;
        const type = classifyOrderType(clientId, clientDeals, config);
        const category = row.typ_castomer ? String(row.typ_castomer).trim() || null : null;
        const order: CountedOrder = {
            orderId: Number(row.order_id),
            managerId,
            clientId,
            clientName: row.client_name ? String(row.client_name).trim() || null : null,
            deals,
            type,
            category,
            enteredAt: row.entered_at,
            createdAt: row.created_at,
            totalsumm: Number(row.totalsumm ?? 0) || 0,
            ...fin,
        };
        teamRevenueNoVat += fin.revenueNoVat;
        const list = byManager.get(managerId) ?? [];
        list.push(order);
        byManager.set(managerId, list);
    }

    // Менеджеры с любой активностью (засчитанные заказы ИЛИ входящие ИЛИ дежурства)
    const managerIds = new Set<number>([
        ...Array.from(byManager.keys()),
        ...Array.from(incomingByManager.keys()),
        ...Array.from(dutyByManager.keys()),
    ]);

    const managers: ManagerMetrics[] = [];
    for (const managerId of Array.from(managerIds)) {
        if (!managerId || managerId <= 0) continue; // отсекаем фантом (заказы без менеджера, manager_id=0/null)
        const orders = byManager.get(managerId) ?? [];
        const countsByType: Record<OrderType, number> = { new: 0, permanent: 0 };
        const countsByCategory: Record<string, number> = {};
        const revenueByCategory: Record<string, number> = {};
        let sumDiscount = 0;
        let sumGoods = 0;
        let noDiscountCount = 0;
        let marginTotal = 0;
        for (const o of orders) {
            countsByType[o.type] += 1;
            if (o.category) {
                countsByCategory[o.category] = (countsByCategory[o.category] ?? 0) + 1;
                revenueByCategory[o.category] = (revenueByCategory[o.category] ?? 0) + o.revenueNoVat;
            }
            sumDiscount += o.discountAmount;
            sumGoods += o.goodsBase;
            marginTotal += o.margin;
            if (o.discountAmount <= 0.005) noDiscountCount += 1;
        }

        // Метрика скидочной дисциплины
        let discountMetricValue: number | null = null;
        if (orders.length > 0) {
            if (config.discount_bonus.metric === 'avg_order_discount_pct') {
                discountMetricValue = sumGoods > 0 ? (sumDiscount / sumGoods) * 100 : 0;
            } else if (config.discount_bonus.metric === 'share_orders_no_discount') {
                discountMetricValue = (noDiscountCount / orders.length) * 100;
            }
        }

        const denominator = incomingByManager.get(managerId) ?? 0;
        const numerator = orders.length; // закрытые сделки месяца
        const conversion = {
            numerator,
            denominator,
            pct: denominator > 0 ? (numerator / denominator) * 100 : 0,
            eligible: denominator >= config.conv_min_zayavki,
        };

        managers.push({
            managerId,
            countedOrders: orders,
            countsByType,
            countsByCategory,
            revenueByCategory,
            discountMetricValue,
            qualityAvgScore: qualityByManager.get(managerId) ?? null,
            qualityScriptPct: scriptByManager.get(managerId) ?? null,
            fastContactShare: fastContactByManager.get(managerId) ?? null,
            fieldsFilledShare: fieldsByManager.get(managerId) ?? null,
            conversion,
            dutyShifts: dutyByManager.get(managerId) ?? 0,
            workedDays: workedDaysByManager.has(managerId) ? workedDaysByManager.get(managerId)! : null,
            marginTotal,
        });
    }

    managers.sort((a, b) => a.managerId - b.managerId);
    return { year, month, teamRevenueNoVat, managers };
}

// ── Оркестратор: грузит сырьё из БД и собирает метрики ───────────────────────

function monthBounds(year: number, month: number): { start: string; end: string } {
    const start = `${year}-${String(month).padStart(2, '0')}-01`;
    const ny = month === 12 ? year + 1 : year;
    const nm = month === 12 ? 1 : month + 1;
    const end = `${ny}-${String(nm).padStart(2, '0')}-01`;
    return { start, end };
}

export async function collectPeriodMetrics(
    year: number,
    month: number,
    configArg?: SalaryConfig,
): Promise<PeriodMetrics> {
    const config = configArg ?? (await getConfigForPeriod(year, month));
    const { start, end } = monthBounds(year, month);
    const closing = config.closing_status.code;

    // 1. Засчитанные заказы периода
    const { data: rowsData, error: rowsErr } = await supabase.rpc('salary_counted_orders', {
        p_start: start,
        p_end: end,
        p_closing: closing,
    });
    if (rowsErr) throw rowsErr;
    const rows = (rowsData as CountedOrderRow[]) ?? [];

    // 2. История сделок по клиентам (для new/permanent)
    const clientIds = Array.from(new Set(rows.map((r) => r.client_id).filter((x): x is number => x != null)));
    const clientDeals = new Map<number, number>();
    if (clientIds.length) {
        const { data: dealData, error: dealErr } = await supabase.rpc('salary_client_deal_counts', {
            p_client_ids: clientIds,
            p_closing: closing,
        });
        if (dealErr) throw dealErr;
        for (const d of (dealData as { client_id: number; deals: number }[]) ?? []) {
            clientDeals.set(Number(d.client_id), Number(d.deals));
        }
    }

    // 3. Входящие за период (знаменатель конверсии)
    const { data: incData, error: incErr } = await supabase.rpc('salary_incoming_counts', {
        p_start: start,
        p_end: end,
        p_exclusions: config.source_exclusions,
    });
    if (incErr) throw incErr;
    const incomingByManager = new Map<number, number>();
    for (const r of (incData as { manager_id: number; incoming: number }[]) ?? []) {
        if (r.manager_id != null) incomingByManager.set(r.manager_id, Number(r.incoming));
    }

    // 4. Качество ОКК по менеджеру за период: AVG(total_score), AVG(script_score_pct),
    //    доля «в работе < 1 дня», доля с полученным ТЗ.
    const qualityByManager = new Map<number, number>();
    const scriptByManager = new Map<number, number>();
    const fastContactByManager = new Map<number, number>();
    const fieldsByManager = new Map<number, number>();
    const { data: scoreData, error: scoreErr } = await supabase
        .from('okk_order_scores')
        .select('manager_id,total_score,script_score_pct,lead_in_work_lt_1_day,tz_received')
        .gte('eval_date', start)
        .lt('eval_date', end);
    if (scoreErr) throw scoreErr;
    type Agg = { sumScore: number; nScore: number; sumScript: number; nScript: number; fast: number; nFast: number; fields: number; nFields: number };
    const scoreAgg = new Map<number, Agg>();
    const getAgg = (mid: number) => {
        const a = scoreAgg.get(mid) ?? { sumScore: 0, nScore: 0, sumScript: 0, nScript: 0, fast: 0, nFast: 0, fields: 0, nFields: 0 };
        scoreAgg.set(mid, a);
        return a;
    };
    for (const s of (scoreData as any[]) ?? []) {
        if (s.manager_id == null) continue;
        const mid = Number(s.manager_id);
        const a = getAgg(mid);
        if (s.total_score != null) { a.sumScore += Number(s.total_score); a.nScore += 1; }
        if (s.script_score_pct != null) { a.sumScript += Number(s.script_score_pct); a.nScript += 1; }
        if (s.lead_in_work_lt_1_day != null) { a.fast += s.lead_in_work_lt_1_day ? 1 : 0; a.nFast += 1; }
        if (s.tz_received != null) { a.fields += s.tz_received ? 1 : 0; a.nFields += 1; }
    }
    for (const [mid, a] of Array.from(scoreAgg)) {
        if (a.nScore > 0) qualityByManager.set(mid, a.sumScore / a.nScore);
        if (a.nScript > 0) scriptByManager.set(mid, a.sumScript / a.nScript);
        if (a.nFast > 0) fastContactByManager.set(mid, (a.fast / a.nFast) * 100);
        if (a.nFields > 0) fieldsByManager.set(mid, (a.fields / a.nFields) * 100);
    }

    // 5. Дежурства и табель (отработанные дни) за период
    const dutyByManager = new Map<number, number>();
    const workedDaysByManager = new Map<number, number>();
    const { data: dutyData, error: dutyErr } = await supabase
        .from('salary_duty')
        .select('manager_id,shifts,kind')
        .gte('work_date', start)
        .lt('work_date', end);
    if (dutyErr) throw dutyErr;
    for (const d of (dutyData as { manager_id: number; shifts: number; kind: string }[]) ?? []) {
        if (d.manager_id == null) continue;
        const mid = Number(d.manager_id);
        if (d.kind === 'worked_day') {
            workedDaysByManager.set(mid, (workedDaysByManager.get(mid) ?? 0) + Number(d.shifts));
        } else {
            dutyByManager.set(mid, (dutyByManager.get(mid) ?? 0) + Number(d.shifts));
        }
    }

    return buildPeriodMetrics({
        year,
        month,
        rows,
        clientDeals,
        incomingByManager,
        qualityByManager,
        scriptByManager,
        fastContactByManager,
        fieldsByManager,
        dutyByManager,
        workedDaysByManager,
        config,
    });
}
