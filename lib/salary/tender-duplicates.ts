// ============================================================================
// Правомочность статуса «Дубль на тендер» — единый источник правила для SQL
// (RPC salary_incoming_counts) и TS (детализация знаменателя конверсии в
// расчётной ведомости). Дубль НЕ учитывается в знаменателе конверсии, только
// если выполнены все три условия:
//   1) в комментарии оператора указан номер заказа-эталона («дубль 53579»);
//   2) сумма дубля = сумме эталона (точное равенство);
//   3) эталон в статусе «Тендер».
// Иначе дубль остаётся в знаменателе (встроенный контроль злоупотребления).
// Коды статусов приходят из salary_config (tender_duplicate_rule) — без хардкода.
// ВАЖНО: regex обязан совпадать с regexp_match в миграции, иначе RPC и
// детализация разойдутся. См. migrations/20260625_salary_tender_duplicate_exclusion.sql
// ============================================================================

export interface TenderDuplicateRule {
    duplicate_status: string;
    /** Допустимые статусы заказа-эталона (вся «тендерная» группа). */
    reference_statuses: string[];
}

export interface DuplicateContext {
    rule: TenderDuplicateRule;
    /** Человеческие имена статусов-эталонов из CRM через « / » (для причины в UI). */
    referenceStatusLabel: string;
}

export interface DuplicateVerdict {
    /** Заказ — со статусом duplicate_status (вообще дубль на тендер). */
    isDuplicate: boolean;
    /** Правомочный дубль — исключается из знаменателя конверсии. */
    excluded: boolean;
    /** Номер заказа-эталона, извлечённый из комментария (если нашёлся). */
    referencedNumber: string | null;
    /** Причина для UI на русском (почему исключён / почему учтён). */
    reason: string | null;
}

export interface DuplicateOrderInput {
    status: string;
    /** Стоимость товаров БЕЗ скидок = Σ initialPrice × количество (см. goodsCostBeforeDiscount). */
    goodsCost: number;
    managerComment: string | null | undefined;
}

export interface ReferencedOrder {
    status: string;
    goodsCost: number;
}

// Должен совпадать с regexp_match(..., 'i') в миграции.
const REFERENCED_NUMBER_RE = /(?:дубль|дубл|dubl)\D*(\d{3,6})/i;

/** Достаёт номер заказа-эталона из комментария оператора («дубль 53579» → 53579). */
export function extractReferencedNumber(comment: string | null | undefined): string | null {
    if (!comment) return null;
    const m = REFERENCED_NUMBER_RE.exec(comment);
    return m ? m[1] : null;
}

/**
 * Стоимость товаров заказа БЕЗ скидок = Σ initialPrice × количество по позициям.
 * Сравниваем дубль и эталон именно по ней (не по totalsumm), т.к. позиционные
 * скидки у дубля и оригинала могут отличаться, а состав/базовая цена — нет.
 * ВАЖНО: логика обязана совпадать с SQL в миграции (jsonb_array_elements + SUM).
 */
export function goodsCostBeforeDiscount(rawPayload: any): number {
    const items = rawPayload?.items;
    if (!Array.isArray(items)) return 0;
    let total = 0;
    for (const it of items) {
        const initial = Number(it?.initialPrice ?? 0) || 0;
        const qty = Number(it?.quantity ?? 0) || 0;
        total += initial * qty;
    }
    return total;
}

/**
 * Оценивает правомочность дубля на тендер. `refOrder` — заказ-эталон, найденный
 * по извлечённому номеру (или null, если не найден / номер не указан).
 */
export function evaluateDuplicate(
    order: DuplicateOrderInput,
    refOrder: ReferencedOrder | null,
    ctx: DuplicateContext,
): DuplicateVerdict {
    const { rule, referenceStatusLabel } = ctx;

    if (order.status !== rule.duplicate_status) {
        return { isDuplicate: false, excluded: false, referencedNumber: null, reason: null };
    }

    const num = extractReferencedNumber(order.managerComment);
    if (!num) {
        return {
            isDuplicate: true,
            excluded: false,
            referencedNumber: null,
            reason: 'учтён: в комментарии не указан номер заказа-эталона',
        };
    }
    if (!refOrder) {
        return {
            isDuplicate: true,
            excluded: false,
            referencedNumber: num,
            reason: `учтён: заказ-эталон №${num} не найден`,
        };
    }
    if (!rule.reference_statuses.includes(refOrder.status)) {
        return {
            isDuplicate: true,
            excluded: false,
            referencedNumber: num,
            reason: `учтён: эталон №${num} не в статусе «${referenceStatusLabel}»`,
        };
    }
    if (Number(refOrder.goodsCost) !== Number(order.goodsCost)) {
        return {
            isDuplicate: true,
            excluded: false,
            referencedNumber: num,
            reason: `учтён: стоимость товаров (без скидок) не совпадает с эталоном №${num}`,
        };
    }

    return {
        isDuplicate: true,
        excluded: true,
        referencedNumber: num,
        reason: `исключён: дубль заказа №${num}`,
    };
}
