// ============================================================================
// Правомочность статуса «Дубль на тендер» — единый источник правила для SQL
// (RPC salary_incoming_counts) и TS (детализация знаменателя конверсии в
// расчётной ведомости). Дубль НЕ учитывается в знаменателе конверсии, только
// если выполнены все три условия:
//   1) в комментарии оператора указан номер заказа-эталона («дубль 53579»);
//   2) хотя бы одна позиция дубля совпадает с позицией эталона по АРТИКУЛУ и
//      КОЛИЧЕСТВУ (см. orderItemKeys/itemsIntersect);
//   3) эталон — или корень цепочки дублей — в одном из «тендерных» статусов ЛИБО
//      уже ушёл в производство (тендер выигран, дубли по нему больше не заявки).
// Иначе дубль остаётся в знаменателе (встроенный контроль злоупотребления).
// Правомочный дубль на тендер исключается и из ЧИСЛИТЕЛЯ (как «дубль заявки»):
// закупку забрал эталон, дубль не должен приносить премию.
//
// Почему состав товара, а не равенство сумм (разбор ОКК за июль 2026): у
// настоящих дублей одного тендера суммы почти никогда не совпадают — тендер
// разбит по лотам (у эталона 2 позиции, у дубля 1), доставка идёт отдельной
// строкой или вшита в цену, торг. организация просит «без НДС», цена уточняется
// после эталона. Совпадение позиции подделать труднее, чем сумму: надо
// скопировать саму позицию из эталона.
//
// Дублем считается заказ со статусом duplicate_status ЛИБО с причиной отмены из
// duplicate_cancel_reasons: отменённый дубль уходит в «Согласование отмены», и
// по одному статусу правило до него не добирается.
//
// Коды статусов/причин приходят из salary_config (tender_duplicate_rule,
// not_our_product_rule) — без хардкода.
// ВАЖНО: regex и логика сравнения позиций обязаны совпадать с SQL в миграции,
// иначе RPC и детализация разойдутся.
// См. migrations/20260729_salary_duplicate_by_items.sql
// ============================================================================

export interface TenderDuplicateRule {
    duplicate_status: string;
    /** Допустимые статусы заказа-эталона (вся «тендерная» группа). */
    reference_statuses: string[];
    /** Причины отмены, равносильные статусу «Дубль на тендер» (дубль отменили). */
    duplicate_cancel_reasons: string[];
}

/** «Не наша продукция» — заявка не на наш товар, из конверсии исключается целиком. */
export interface NotOurProductRule {
    statuses: string[];
    cancel_reasons: string[];
}

export interface DuplicateContext {
    rule: TenderDuplicateRule;
    /** Человеческие имена статусов-эталонов из CRM через « / » (для причины в UI). */
    referenceStatusLabel: string;
}

export interface DuplicateVerdict {
    /** Заказ — дубль на тендер (по статусу или причине отмены). */
    isDuplicate: boolean;
    /** Правомочный дубль — исключается из знаменателя конверсии. */
    excluded: boolean;
    /** Номер заказа-эталона, извлечённый из комментария (если нашёлся). */
    referencedNumber: string | null;
    /** Причина для UI на русском (почему исключён / почему учтён). */
    reason: string | null;
}

/** Заказ в объёме, нужном правилам дублей. */
export interface DuplicateOrderInput {
    status: string;
    managerComment: string | null | undefined;
    /** Код причины отмены (кастом-поле заказа), если проставлен. */
    cancelReason: string | null | undefined;
    /** Ключи позиций «артикул|количество» — см. orderItemKeys(). */
    itemKeys: Set<string>;
}

/** Заказ-эталон: то же самое плюс номер (нужен для текста причины и цепочки). */
export interface ReferencedOrder extends DuplicateOrderInput {
    number: string;
    /**
     * Эталон выиграл — когда-либо уходил в производство (closing-статус).
     * Тендер сыгран, дубли по нему больше не заявки: правомочен наравне с
     * «тендерными» статусами. Считается по той же канве, что членство в
     * числителе (история перехода в closing-статус либо текущий статус).
     */
    wonProduction: boolean;
}

// Должен совпадать с regexp_match(..., 'i') в миграции.
const REFERENCED_NUMBER_RE = /(?:дубль|дубл|dubl)\D*(\d{3,6})/i;
// Токен «дубль NNNN» для вырезания при проверке причины (совпадает с regexp_replace в миграции).
const REFERENCE_TOKEN_RE = /(?:дубль|дубл|dubl)\D*\d{3,6}/gi;
// Осмысленный текст = слово из ≥3 букв (латиница/кириллица). Совпадает с SQL.
const REASON_WORD_RE = /[A-Za-zА-Яа-яЁё]{3,}/;
// Предел разворота цепочки «дубль дубля» — защита от длинных цепочек и циклов.
export const MAX_DUPLICATE_CHAIN_DEPTH = 5;

/** Достаёт номер заказа-эталона из комментария оператора («дубль 53579» → 53579). */
export function extractReferencedNumber(comment: string | null | undefined): string | null {
    if (!comment) return null;
    const m = REFERENCED_NUMBER_RE.exec(comment);
    return m ? m[1] : null;
}

/** Есть ли в комментарии причина (текст помимо самого «дубль NNNN»). Зеркалит SQL. */
export function hasReasonText(comment: string | null | undefined): boolean {
    if (!comment) return false;
    const stripped = String(comment).replace(REFERENCE_TOKEN_RE, ' ');
    return REASON_WORD_RE.test(stripped);
}

/**
 * Стоимость товаров заказа БЕЗ скидок = Σ initialPrice × количество по позициям.
 * В правиле дублей больше не участвует (заменена сравнением состава), остаётся
 * как показатель заказа для отчётов и тестов.
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
 * Ключи позиций заказа для сравнения состава: «идентификатор|количество».
 * На позицию выдаём НЕСКОЛЬКО ключей — по каждому идентификатору товара:
 * xmlId (номенклатура учётной системы), артикул, externalId. Совпадение по
 * любому = тот же товар.
 *
 * Почему не только артикул: в каталоге CRM встречаются две карточки одной
 * номенклатуры (одна с человеческим артикулом, другая с числовым кодом) —
 * реальный кейс 53760 против 53757/53761: article «СССЛ2.ЛП.МД.50.2000.1730.500»
 * против «49407» при одном и том же xmlId и названии.
 *
 * Значения нормализуем (trim + нижний регистр) — позиции заводят вручную.
 * Пустые идентификаторы ключа не дают: сравнивать нечего, случайного совпадения
 * быть не должно.
 * ВАЖНО: обязана совпадать с SQL в миграции.
 */
export function orderItemKeys(rawPayload: any): Set<string> {
    const keys = new Set<string>();
    const items = rawPayload?.items;
    if (!Array.isArray(items)) return keys;
    for (const it of items) {
        const qty = Number(it?.quantity ?? 0) || 0;
        for (const [prefix, raw] of [
            ['xml', it?.offer?.xmlId],
            ['art', it?.offer?.article],
            ['ext', it?.offer?.externalId],
        ] as const) {
            const value = String(raw ?? '').trim().toLowerCase();
            if (value) keys.add(`${prefix}:${value}|${qty}`);
        }
    }
    return keys;
}

/** Есть ли у заказов хотя бы одна общая позиция (артикул + количество). */
export function itemsIntersect(a: Set<string>, b: Set<string>): boolean {
    if (a.size === 0 || b.size === 0) return false;
    const [small, large] = a.size <= b.size ? [a, b] : [b, a];
    for (const key of Array.from(small)) {
        if (large.has(key)) return true;
    }
    return false;
}

/** Заказ помечен как дубль на тендер: статусом либо причиной отмены. */
export function isTenderDuplicate(
    order: Pick<DuplicateOrderInput, 'status' | 'cancelReason'>,
    rule: TenderDuplicateRule,
): boolean {
    if (order.status === rule.duplicate_status) return true;
    const reason = order.cancelReason ? String(order.cancelReason) : '';
    return !!reason && (rule.duplicate_cancel_reasons ?? []).includes(reason);
}

/** Заявка не на нашу продукцию: статусом либо причиной отмены. */
export function isNotOurProduct(
    order: Pick<DuplicateOrderInput, 'status' | 'cancelReason'>,
    rule: NotOurProductRule,
): boolean {
    if ((rule.statuses ?? []).includes(order.status)) return true;
    const reason = order.cancelReason ? String(order.cancelReason) : '';
    return !!reason && (rule.cancel_reasons ?? []).includes(reason);
}

/**
 * Разворачивает цепочку дублей до первоисточника: если эталон сам «Дубль на
 * тендер», идём к ЕГО эталону. Реальный кейс — 53886 → 53873 → 53478: без
 * разворота условие «эталон в тендерном статусе» ломается на середине цепочки.
 * Возвращает первый НЕ-дубль; если цепочка оборвалась (эталона нет в выборке,
 * цикл, предел глубины) — последний найденный заказ.
 */
export function resolveDuplicateRoot(
    start: ReferencedOrder,
    byNumber: Map<string, ReferencedOrder>,
    rule: TenderDuplicateRule,
): ReferencedOrder {
    let current = start;
    const seen = new Set<string>([current.number]);
    for (let depth = 0; depth < MAX_DUPLICATE_CHAIN_DEPTH; depth++) {
        if (!isTenderDuplicate(current, rule)) return current;
        const nextNumber = extractReferencedNumber(current.managerComment);
        if (!nextNumber || seen.has(nextNumber)) return current;
        const next = byNumber.get(nextNumber);
        if (!next) return current;
        seen.add(nextNumber);
        current = next;
    }
    return current;
}

/**
 * Оценивает правомочность дубля на тендер. `root` — первоисточник цепочки
 * дублей (см. resolveDuplicateRoot) или null, если эталон не найден / номер
 * не указан.
 */
export function evaluateDuplicate(
    order: DuplicateOrderInput,
    root: ReferencedOrder | null,
    ctx: DuplicateContext,
): DuplicateVerdict {
    const { rule, referenceStatusLabel } = ctx;

    if (!isTenderDuplicate(order, rule)) {
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
    if (!root) {
        return {
            isDuplicate: true,
            excluded: false,
            referencedNumber: num,
            reason: `учтён: заказ-эталон №${num} не найден`,
        };
    }

    // Через цепочку дублей пришли к другому заказу — называем его первоисточником,
    // иначе менеджер не поймёт, почему в причине чужой номер. Два падежа: причины
    // читаются людьми, «не совпадает с эталон №N» недопустимо.
    const viaChain = root.number === num ? '' : ` (через дубль №${num})`;
    const refNominative = root.number === num ? `эталон №${num}` : `первоисточник №${root.number}${viaChain}`;
    const refGenitive = root.number === num ? `эталона №${num}` : `первоисточника №${root.number}${viaChain}`;

    // Правомочен либо ещё живой тендер, либо уже выигранный (эталон в производстве).
    if (!rule.reference_statuses.includes(root.status) && !root.wonProduction) {
        return {
            isDuplicate: true,
            excluded: false,
            referencedNumber: num,
            reason: `учтён: ${refNominative} не в статусе «${referenceStatusLabel}» и не передан в производство`,
        };
    }
    if (!itemsIntersect(order.itemKeys, root.itemKeys)) {
        return {
            isDuplicate: true,
            excluded: false,
            referencedNumber: num,
            reason: `учтён: ни один товар не совпадает с позициями ${refGenitive} по наименованию и количеству`,
        };
    }

    return {
        isDuplicate: true,
        excluded: true,
        referencedNumber: num,
        reason: root.number === num
            ? `исключён: дубль заказа №${num}`
            : `исключён: дубль заказа №${num}, первоисточник №${root.number}`,
    };
}

export interface RequestDuplicateRule {
    duplicate_status: string;
}

/**
 * Правомочность «Дубля заявки» (email+бот дубли). Исключается из числителя и
 * знаменателя конверсии, только если: статус = duplicate_status, в комментарии
 * указан номер СУЩЕСТВУЮЩЕГО заказа-эталона и есть пояснительный текст (причина).
 * `refExists` — найден ли эталон по извлечённому номеру. Зеркалит SQL в миграции.
 */
export function evaluateRequestDuplicate(
    order: { status: string; managerComment: string | null | undefined },
    refExists: boolean,
    rule: RequestDuplicateRule,
): DuplicateVerdict {
    if (order.status !== rule.duplicate_status) {
        return { isDuplicate: false, excluded: false, referencedNumber: null, reason: null };
    }
    const num = extractReferencedNumber(order.managerComment);
    if (!num) {
        return { isDuplicate: true, excluded: false, referencedNumber: null, reason: 'учтён: дубль заявки без номера заказа-эталона' };
    }
    if (!refExists) {
        return { isDuplicate: true, excluded: false, referencedNumber: num, reason: `учтён: заказ-эталон №${num} не найден` };
    }
    if (!hasReasonText(order.managerComment)) {
        return { isDuplicate: true, excluded: false, referencedNumber: num, reason: 'учтён: в комментарии не указана причина дубля' };
    }
    return { isDuplicate: true, excluded: true, referencedNumber: num, reason: `исключён: дубль заявки №${num}` };
}
