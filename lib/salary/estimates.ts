// ============================================================================
// Правило «Смета» — единый источник для SQL (RPC salary_incoming_counts /
// salary_counted_orders) и TS (детализация конверсии в расчётной ведомости).
//
// Смета — это не потерянная продажа: клиент не покупает, а запрашивает цену,
// чтобы заложить её в бюджет на далёкое будущее (закупка через год-два или без
// срока вообще). В знаменателе конверсии такой заказ стоит наравне с реальной
// заявкой и занижает показатель менеджера, поэтому выводится из конверсии
// целиком — и из знаменателя, и из числителя.
//
// Правило работает ТОЛЬКО внутри статусов из rule.statuses (по требованию —
// «Согласование отмены»; в «Отложено» и прочие статусы намеренно не лезем) и
// имеет две ветки:
//   1) причина отмены из rule.cancel_reasons («Смета») — явный выбор менеджера
//      из справочника CRM, достаточно сам по себе;
//   2) текстовый маркер из rule.comment_patterns в комментарии оператора или
//      клиента — сам по себе слишком шумный («не работают по сметам», «запрос
//      сметы был»), поэтому требует ПОДТВЕРЖДЕНИЯ ПО ДИАЛОГУ: вердикт
//      ИИ-классификатора (таблица order_estimate_verdicts) с уверенностью не
//      ниже rule.min_confidence.
// Вердикта нет (звонков не было, расшифровки нет) — заказ остаётся в конверсии.
// Это встроенный контроль злоупотребления, как у правил дублей.
//
// Почему ветки именно такие (разбор данных за 6 месяцев, scratch/probe-smeta*.mjs):
// из 77 кандидатов в «Согласовании отмены» 58 имеют причину «Смета», 38 —
// текстовый маркер, а пересечение всего 19: сигналы почти не дублируют друг
// друга, одной ветки мало. Транскрипты при этом есть лишь у 47% кандидатов —
// требовать ИИ-подтверждение для обеих веток значило бы не исключить половину.
//
// Коды статусов, причин и маркеры приходят из salary_config (estimate_rule) —
// без хардкода. ВАЖНО: логика обязана совпадать с SQL в миграции, иначе RPC и
// детализация ведомости разойдутся.
// См. migrations/20260803_salary_estimate_exclusion.sql
// ============================================================================

export interface EstimateRule {
    /** Статусы, внутри которых правило вообще применяется. */
    statuses: string[];
    /** Причины отмены, означающие смету (самодостаточный признак). */
    cancel_reasons: string[];
    /** Текстовые маркеры в комментариях (требуют подтверждения по диалогу). */
    comment_patterns: string[];
    /** Порог уверенности вердикта ИИ, ниже которого он не засчитывается. */
    min_confidence: number;
}

/** Заказ в объёме, нужном правилу «Смета». */
export interface EstimateOrderInput {
    status: string;
    /** Код причины отмены (кастом-поле заказа), если проставлен. */
    cancelReason: string | null | undefined;
    managerComment: string | null | undefined;
    customerComment: string | null | undefined;
}

/** Вердикт ИИ-классификатора по диалогу (строка order_estimate_verdicts). */
export interface EstimateVerdictRow {
    /** null — «нет данных для решения» (звонков/расшифровок не было). */
    is_estimate: boolean | null;
    confidence: number | null;
}

export interface EstimateVerdict {
    /** Заказ попал под сигнал сметы (причина отмены или текстовый маркер). */
    isEstimate: boolean;
    /** Смета подтверждена — исключается из конверсии. */
    excluded: boolean;
    /** Причина для UI на русском (почему исключён / почему учтён). */
    reason: string | null;
}

/** Причина отмены заказа = «Смета». Зеркалит ветку 1 в SQL. */
export function isEstimateReason(
    order: Pick<EstimateOrderInput, 'cancelReason'>,
    rule: EstimateRule,
): boolean {
    const reason = order.cancelReason ? String(order.cancelReason) : '';
    return !!reason && (rule.cancel_reasons ?? []).includes(reason);
}

/**
 * Текстовый маркер сметы в комментариях оператора или клиента.
 * Зеркалит SQL: конкатенация двух комментариев через пробел, нижний регистр,
 * поиск подстроки (LIKE '%pat%'). Маркеры в конфиге хранятся уже в нижнем
 * регистре, но приводим обе стороны — конфиг редактируют руками.
 */
export function hasEstimateMarker(
    order: Pick<EstimateOrderInput, 'managerComment' | 'customerComment'>,
    rule: EstimateRule,
): boolean {
    const haystack = `${order.managerComment ?? ''} ${order.customerComment ?? ''}`.toLowerCase();
    return (rule.comment_patterns ?? []).some((pat) => {
        const needle = String(pat ?? '').toLowerCase();
        return !!needle && haystack.includes(needle);
    });
}

/** Вердикт ИИ подтверждает смету: is_estimate = true и уверенность не ниже порога. */
export function isVerdictConfirmed(
    verdict: EstimateVerdictRow | null | undefined,
    rule: EstimateRule,
): boolean {
    if (!verdict || verdict.is_estimate !== true) return false;
    return Number(verdict.confidence ?? 0) >= Number(rule.min_confidence ?? 0);
}

/**
 * Оценивает заказ по правилу «Смета». `verdict` — строка order_estimate_verdicts
 * по этому заказу (или null, если классификатор ещё не отработал / данных не было).
 */
export function evaluateEstimate(
    order: EstimateOrderInput,
    verdict: EstimateVerdictRow | null | undefined,
    rule: EstimateRule,
): EstimateVerdict {
    // Правило живёт только внутри своих статусов.
    if (!(rule.statuses ?? []).includes(order.status)) {
        return { isEstimate: false, excluded: false, reason: null };
    }

    // Ветка 1: причина отмены проставлена менеджером — этого достаточно.
    if (isEstimateReason(order, rule)) {
        return {
            isEstimate: true,
            excluded: true,
            reason: 'исключён: смета — запрос цены для бюджета, не продажа',
        };
    }

    // Ветка 2: только текстовый маркер — нужно подтверждение по диалогу.
    if (!hasEstimateMarker(order, rule)) {
        return { isEstimate: false, excluded: false, reason: null };
    }
    if (!verdict) {
        return {
            isEstimate: true,
            excluded: false,
            reason: 'учтён: смета упомянута в комментарии, но диалог не проверен',
        };
    }
    if (verdict.is_estimate == null) {
        return {
            isEstimate: true,
            excluded: false,
            reason: 'учтён: смета упомянута в комментарии, но в диалоге нет данных о сроке закупки',
        };
    }
    if (verdict.is_estimate === false) {
        return {
            isEstimate: true,
            excluded: false,
            reason: 'учтён: по диалогу закупка планируется в обозримый срок',
        };
    }
    if (!isVerdictConfirmed(verdict, rule)) {
        return {
            isEstimate: true,
            excluded: false,
            reason: 'учтён: смета по диалогу не подтверждена уверенно',
        };
    }

    return {
        isEstimate: true,
        excluded: true,
        reason: 'исключён: смета — по диалогу закупка не раньше чем через год либо срок неизвестен',
    };
}
