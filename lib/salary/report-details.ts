import { supabase } from '@/utils/supabase';
import { getConfigForPeriod } from '@/lib/salary/config';
import { evaluateDuplicate, extractReferencedNumber, goodsCostBeforeDiscount } from '@/lib/salary/tender-duplicates';

// ============================================================================
// Детализация расчётной ведомости заказами — отдаётся ВМЕСТЕ с отчётом
// (/api/salary, /api/salary/my), без отдельных запросов по клику. Источники:
//   teamOrders   — из уже сохранённых breakdown.countedOrders всех строк периода
//                  (выручка отдела под К_команды);
//   incoming     — поступившие за месяц заявки (знаменатель конверсии), один
//                  запрос к orders; отметку «продан» клиент считает по
//                  breakdown.countedOrderIds своей строки.
// ============================================================================

export interface IncomingOrderBrief {
    id: number;
    clientName: string | null;
    source: string | null; // имя источника заявки (orderMethod) из справочника RetailCRM
    createdAt: string;
    sum: number;
    // Дубль на тендер: excluded — правомочный дубль, исключён из знаменателя
    // конверсии; dupNote — причина (русская) для пометки в ведомости.
    excluded?: boolean;
    dupNote?: string | null;
}

export interface TeamOrderBrief {
    id: number;
    managerId: number;
    managerName: string;
    clientName: string | null;
    revenueNoVat: number;
    sum: number;
    enteredAt: string;
}

export interface TeamOrders {
    orders: TeamOrderBrief[];
    teamRevenueNoVat: number;
}

function monthBounds(year: number, month: number): { start: string; end: string } {
    const start = `${year}-${String(month).padStart(2, '0')}-01`;
    const ny = month === 12 ? year + 1 : year;
    const nm = month === 12 ? 1 : month + 1;
    const end = `${ny}-${String(nm).padStart(2, '0')}-01`;
    return { start, end };
}

// Имя клиента из CRM (raw_payload): компания → ФИО клиента → ФИО контакта.
function clientNameFromPayload(p: any): string | null {
    const cust = p?.customer;
    const contact = p?.contact;
    const nick = typeof cust?.nickName === 'string' ? cust.nickName.trim() : '';
    const custFio = [cust?.firstName, cust?.lastName].filter(Boolean).join(' ').trim();
    const contactFio = [contact?.firstName, contact?.lastName].filter(Boolean).join(' ').trim();
    return nick || custFio || contactFio || null;
}

/** Заказы отдела (из чего сложилась выручка отдела) — из сохранённых расчётов периода. */
export async function buildTeamOrders(periodId: number): Promise<TeamOrders> {
    const { data: rows } = await supabase
        .from('salary_calc')
        .select('manager_id,breakdown')
        .eq('period_id', periodId);

    const managerIds = Array.from(new Set((rows ?? []).map((r: any) => Number(r.manager_id))));
    const namesById = new Map<number, string>();
    if (managerIds.length) {
        const { data: mgrs } = await supabase
            .from('managers')
            .select('id,first_name,last_name')
            .in('id', managerIds);
        for (const mgr of (mgrs as any[]) ?? []) {
            namesById.set(Number(mgr.id), [mgr.first_name, mgr.last_name].filter(Boolean).join(' ') || `#${mgr.id}`);
        }
    }

    const orders: TeamOrderBrief[] = [];
    let total = 0;
    for (const r of (rows as any[]) ?? []) {
        const mid = Number(r.manager_id);
        const co: any[] = Array.isArray(r.breakdown?.countedOrders) ? r.breakdown.countedOrders : [];
        for (const o of co) {
            const revenueNoVat = Math.round(Number(o.revenueNoVat) || 0);
            orders.push({
                id: Number(o.id),
                managerId: mid,
                managerName: namesById.get(mid) || `#${mid}`,
                clientName: o.clientName ?? null,
                revenueNoVat,
                sum: Math.round(Number(o.sum) || 0),
                enteredAt: o.enteredAt,
            });
            total += revenueNoVat;
        }
    }
    orders.sort((a, b) => b.revenueNoVat - a.revenueNoVat);
    return { orders, teamRevenueNoVat: total };
}

/** Поступившие за месяц заявки по менеджеру (знаменатель конверсии). */
export async function buildIncomingByManager(
    year: number,
    month: number,
    managerIds?: number[],
): Promise<Record<number, IncomingOrderBrief[]>> {
    const config = await getConfigForPeriod(year, month);
    const exclusions: string[] = config.source_exclusions ?? [];
    const rule = config.tender_duplicate_rule;
    const { start, end } = monthBounds(year, month);

    let q = supabase
        .from('orders')
        .select('order_id,manager_id,totalsumm,created_at,raw_payload,status')
        .gte('created_at', start)
        .lt('created_at', end)
        .range(0, 9999); // снимаем дефолтный лимит 1000 строк
    if (managerIds && managerIds.length) q = q.in('manager_id', managerIds);
    const { data, error } = await q;
    if (error) throw error;

    // Человеческие имена источников заявки (никаких кодов в UI).
    const { data: methodRows } = await supabase
        .from('retailcrm_dictionaries')
        .select('item_code,item_name')
        .eq('entity_type', 'orderMethod');
    const methodName = new Map<string, string>();
    for (const r of (methodRows as any[]) ?? []) methodName.set(r.item_code, r.item_name);

    // Человеческие имена статусов-эталонов («Тендер» / «Ожидание выхода тендера»)
    // для текста причины (имена из CRM).
    const { data: refStatusRows } = await supabase
        .from('retailcrm_dictionaries')
        .select('item_code,item_name')
        .eq('entity_type', 'status')
        .in('item_code', rule.reference_statuses);
    const refNameByCode = new Map<string, string>();
    for (const r of (refStatusRows as any[]) ?? []) refNameByCode.set(r.item_code, r.item_name);
    const referenceStatusLabel = rule.reference_statuses
        .map((code) => refNameByCode.get(code) || code)
        .join(' / ');

    // Эталоны дублей: собираем номера из комментариев и грузим одним запросом.
    const refNumbers = new Set<string>();
    for (const o of (data as any[]) ?? []) {
        if (String(o.status ?? '') !== rule.duplicate_status) continue;
        const num = extractReferencedNumber(o.raw_payload?.managerComment);
        if (num) refNumbers.add(num);
    }
    const refByNumber = new Map<string, { status: string; goodsCost: number }>();
    if (refNumbers.size) {
        const { data: refs } = await supabase
            .from('orders')
            .select('number,status,raw_payload')
            .in('number', Array.from(refNumbers));
        for (const r of (refs as any[]) ?? []) {
            refByNumber.set(String(r.number), {
                status: String(r.status ?? ''),
                goodsCost: goodsCostBeforeDiscount(r.raw_payload),
            });
        }
    }

    const byManager: Record<number, IncomingOrderBrief[]> = {};
    for (const o of (data as any[]) ?? []) {
        const om = String(o.raw_payload?.orderMethod ?? '');
        if (exclusions.includes(om)) continue; // как в salary_incoming_counts
        const mid = Number(o.manager_id);
        if (!mid) continue;
        const num = extractReferencedNumber(o.raw_payload?.managerComment);
        const verdict = evaluateDuplicate(
            {
                status: String(o.status ?? ''),
                goodsCost: goodsCostBeforeDiscount(o.raw_payload),
                managerComment: o.raw_payload?.managerComment ?? null,
            },
            num ? refByNumber.get(num) ?? null : null,
            { rule, referenceStatusLabel },
        );
        (byManager[mid] ??= []).push({
            id: Number(o.order_id),
            clientName: clientNameFromPayload(o.raw_payload),
            source: om ? methodName.get(om) || om : null,
            createdAt: o.created_at,
            sum: Number(o.totalsumm ?? 0) || 0,
            excluded: verdict.excluded,
            dupNote: verdict.reason,
        });
    }
    for (const mid of Object.keys(byManager)) {
        byManager[Number(mid)].sort((a, b) => a.id - b.id);
    }
    return byManager;
}
