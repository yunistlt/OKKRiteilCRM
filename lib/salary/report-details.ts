import { supabase } from '@/utils/supabase';
import { getConfigForPeriod } from '@/lib/salary/config';
import {
    evaluateDuplicate,
    evaluateRequestDuplicate,
    extractReferencedNumber,
    isNotOurProduct,
    isTenderDuplicate,
    orderItemKeys,
    resolveDuplicateRoot,
    MAX_DUPLICATE_CHAIN_DEPTH,
    type ReferencedOrder,
} from '@/lib/salary/tender-duplicates';
import { evaluateEstimate, hasEstimateMarker, type EstimateVerdictRow } from '@/lib/salary/estimates';

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
    // Дубль на тендер или смета: excluded — заказ исключён из знаменателя
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

/**
 * Заказы отдела (из чего сложилась выручка отдела). По умолчанию — из снимка
 * salary_calc; для открытого периода вызывающий передаёт live-строки (preloadedRows),
 * чтобы раскрытие показывало актуальные заказы, а не устаревший снимок.
 */
export async function buildTeamOrders(
    periodId: number,
    preloadedRows?: { manager_id: number; breakdown: any }[],
): Promise<TeamOrders> {
    const rows =
        preloadedRows ??
        (
            await supabase
                .from('salary_calc')
                .select('manager_id,breakdown')
                .eq('period_id', periodId)
        ).data;

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
    const excludedStatuses: string[] = config.conversion_excluded_statuses ?? [];
    const rule = config.tender_duplicate_rule;
    const reqRule = config.request_duplicate_rule;
    const notOurRule = config.not_our_product_rule;
    const estimateRule = config.estimate_rule;
    const reasonField = config.cancel_reason_field.code;
    const closing = config.closing_status.code;
    const { start, end } = monthBounds(year, month);
    const cancelReasonOf = (payload: any): string | null =>
        (payload?.customFields?.[reasonField] as string | undefined) ?? null;

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

    // ── Признаки из ИСТОРИИ статусов (order_history_log) ─────────────────────
    // Текущего статуса мало: эталон уезжает в отмену («не выиграли») или вперёд
    // («Счёт выставлен»), дубль — в «Согласование отмены». Без истории вердикт
    // менялся задним числом вслед за движением заказов. Зеркалит
    // salary_order_was_in_statuses / salary_order_won_production в SQL.
    const historyCodes = Array.from(
        new Set([closing, rule.duplicate_status, ...rule.reference_statuses]),
    );
    const statusHistoryCache = new Map<number, Set<string>>();
    const loadStatusHistory = async (orderIds: number[]): Promise<void> => {
        const missing = orderIds.filter((id) => Number.isFinite(id) && !statusHistoryCache.has(id));
        if (!missing.length) return;
        for (const id of missing) statusHistoryCache.set(id, new Set());
        const { data: hist } = await supabase
            .from('order_history_log')
            .select('retailcrm_order_id,new_value')
            .eq('field', 'status')
            .in('retailcrm_order_id', missing)
            .range(0, 99999);
        for (const h of (hist as any[]) ?? []) {
            const raw = String(h.new_value ?? '');
            const set = statusHistoryCache.get(Number(h.retailcrm_order_id));
            if (!set) continue;
            for (const code of historyCodes) {
                if (raw.includes(`"code":"${code}"`)) set.add(code);
            }
        }
    };
    // Был ли заказ когда-либо в одном из статусов (или находится в нём сейчас).
    const wasInStatuses = (orderId: number, status: string, codes: string[]): boolean => {
        if (codes.includes(status)) return true;
        const seen = statusHistoryCache.get(orderId);
        return !!seen && codes.some((code) => seen.has(code));
    };

    const orderIds = ((data as any[]) ?? [])
        .map((o) => Number(o.order_id))
        .filter((id) => Number.isFinite(id));
    if (rule.use_status_history && orderIds.length) await loadStatusHistory(orderIds);

    // Заказ периода в объёме правила дублей — с признаками из истории.
    const dupInputOf = (o: any) => {
        const id = Number(o.order_id);
        const st = String(o.status ?? '');
        return {
            status: st,
            cancelReason: cancelReasonOf(o.raw_payload),
            managerComment: o.raw_payload?.managerComment ?? null,
            itemKeys: orderItemKeys(o.raw_payload),
            wasDuplicateStatus: rule.use_status_history
                ? wasInStatuses(id, st, [rule.duplicate_status])
                : false,
            wonProduction: wasInStatuses(id, st, [closing]),
        };
    };

    // Эталоны дублей (тендер + заявка). Цепочку «дубль дубля» разворачиваем
    // итеративно: если доставший эталон сам оказался дублем — добираем ЕГО эталон,
    // иначе до первоисточника не дойти (реальный кейс 53886 → 53873 → 53478).
    const refByNumber = new Map<string, ReferencedOrder>();
    let pending = new Set<string>();
    for (const o of (data as any[]) ?? []) {
        const st = String(o.status ?? '');
        const isDup = isTenderDuplicate(dupInputOf(o), rule);
        if (!isDup && st !== reqRule.duplicate_status) continue;
        const num = extractReferencedNumber(o.raw_payload?.managerComment);
        if (num) pending.add(num);
    }
    for (let depth = 0; depth <= MAX_DUPLICATE_CHAIN_DEPTH && pending.size; depth++) {
        const { data: refs } = await supabase
            .from('orders')
            .select('order_id,number,status,raw_payload')
            .in('number', Array.from(pending));
        // История эталонов нужна ДО разбора цепочки: звено, которое увели из
        // статуса дубля, иначе примут за первоисточник и обход оборвётся.
        await loadStatusHistory(((refs as any[]) ?? []).map((r) => Number(r.order_id)));
        const next = new Set<string>();
        for (const r of (refs as any[]) ?? []) {
            const refId = Number(r.order_id);
            const refStatus = String(r.status ?? '');
            const ref: ReferencedOrder = {
                number: String(r.number),
                status: refStatus,
                cancelReason: cancelReasonOf(r.raw_payload),
                managerComment: r.raw_payload?.managerComment ?? null,
                itemKeys: orderItemKeys(r.raw_payload),
                // Эталон мог уйти в производство и поехать дальше по воронке
                // (отгружен, выполнен) — смотрим и текущий статус, и историю.
                wonProduction: wasInStatuses(refId, refStatus, [closing]),
                wasDuplicateStatus: rule.use_status_history
                    ? wasInStatuses(refId, refStatus, [rule.duplicate_status])
                    : false,
                wasReferenceStatus: rule.use_status_history
                    ? wasInStatuses(refId, refStatus, rule.reference_statuses)
                    : false,
            };
            refByNumber.set(ref.number, ref);
            if (!isTenderDuplicate(ref, rule)) continue;
            const nextNum = extractReferencedNumber(ref.managerComment);
            if (nextNum && !refByNumber.has(nextNum)) next.add(nextNum);
        }
        pending = next;
    }

    // Вердикты ИИ по «сметам» — одним запросом на всех кандидатов (заказ в статусе
    // правила с текстовым маркером). Ветка «причина отмены = Смета» вердикта не
    // требует, поэтому кандидатов заведомо немного.
    const estimateCandidateIds: number[] = [];
    for (const o of (data as any[]) ?? []) {
        if (!estimateRule.statuses.includes(String(o.status ?? ''))) continue;
        const marked = hasEstimateMarker(
            {
                managerComment: o.raw_payload?.managerComment ?? null,
                customerComment: o.raw_payload?.customerComment ?? null,
            },
            estimateRule,
        );
        if (marked && o.order_id != null) estimateCandidateIds.push(Number(o.order_id));
    }
    const estimateVerdicts = new Map<number, EstimateVerdictRow>();
    if (estimateCandidateIds.length) {
        const { data: verdictRows } = await supabase
            .from('order_estimate_verdicts')
            .select('retailcrm_order_id,is_estimate,confidence')
            .in('retailcrm_order_id', estimateCandidateIds);
        for (const v of (verdictRows as any[]) ?? []) {
            estimateVerdicts.set(Number(v.retailcrm_order_id), {
                is_estimate: v.is_estimate ?? null,
                confidence: v.confidence == null ? null : Number(v.confidence),
            });
        }
    }

    const byManager: Record<number, IncomingOrderBrief[]> = {};
    for (const o of (data as any[]) ?? []) {
        const om = String(o.raw_payload?.orderMethod ?? '');
        if (exclusions.includes(om)) continue; // как в salary_incoming_counts
        const st = String(o.status ?? '');
        if (excludedStatuses.includes(st)) continue; // спам — не заявка
        const cancelReason = cancelReasonOf(o.raw_payload);
        // Не наша продукция — не заявка на наш товар, в знаменателе не участвует
        // (в RPC исключается так же, поэтому и списка тут быть не должно).
        if (isNotOurProduct({ status: st, cancelReason }, notOurRule)) continue;
        const mid = Number(o.manager_id);
        if (!mid) continue;
        // Смета проверяется до дублей: заказ в «Согласовании отмены» с причиной
        // «Смета» дублем быть не может, а причина исключения должна быть та, что
        // сработала в RPC. Показываем такой заказ в списке помеченным (excluded),
        // а не прячем — менеджеру должно быть видно, почему он не в конверсии.
        const estimate = evaluateEstimate(
            {
                status: st,
                cancelReason,
                managerComment: o.raw_payload?.managerComment ?? null,
                customerComment: o.raw_payload?.customerComment ?? null,
            },
            estimateVerdicts.get(Number(o.order_id)) ?? null,
            estimateRule,
        );
        if (estimate.isEstimate) {
            (byManager[mid] ??= []).push({
                id: Number(o.order_id),
                clientName: clientNameFromPayload(o.raw_payload),
                source: om ? methodName.get(om) || om : null,
                createdAt: o.created_at,
                sum: Number(o.totalsumm ?? 0) || 0,
                excluded: estimate.excluded,
                dupNote: estimate.reason,
            });
            continue;
        }
        const num = extractReferencedNumber(o.raw_payload?.managerComment);
        const seed = num ? refByNumber.get(num) ?? null : null;
        const verdict =
            st === reqRule.duplicate_status
                ? evaluateRequestDuplicate(
                      { status: st, managerComment: o.raw_payload?.managerComment ?? null },
                      !!seed,
                      reqRule,
                  )
                : evaluateDuplicate(
                      dupInputOf(o),
                      seed ? resolveDuplicateRoot(seed, refByNumber, rule) : null,
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
