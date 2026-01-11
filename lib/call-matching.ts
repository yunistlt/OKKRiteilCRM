import { supabase } from '@/utils/supabase';
import { normalizePhone, phonesMatch, phonesPartialMatch } from './phone-utils';

/**
 * Типы для матчинга
 */
export interface RawCall {
    telphin_call_id: string;
    from_number: string;
    to_number: string;
    from_number_normalized: string | null;
    to_number_normalized: string | null;
    started_at: string;
    direction: string;
}

export interface OrderCandidate {
    retailcrm_order_id: number;
    phone: string | null;
    additional_phone: string | null;
    manager_id: number | null;
    last_event_at: string | null;
}

export interface MatchResult {
    telphin_call_id: string;
    retailcrm_order_id: number;
    match_type: 'by_phone_time' | 'by_phone_manager' | 'by_partial_phone' | 'manual';
    confidence_score: number;
    explanation: string;
    matching_factors: {
        phone_match: boolean;
        partial_phone_match: boolean;
        time_diff_sec: number | null;
        manager_match: boolean;
        direction: string;
    };
}

/**
 * Находит кандидатов заказов по номеру телефона
 * Использует денормализованные поля для быстрого поиска
 */
async function findOrderCandidatesByPhone(phone: string): Promise<OrderCandidate[]> {
    const normalized = normalizePhone(phone);
    if (!normalized) return [];

    const suffix = normalized.slice(-7); // Последние 7 цифр (восстановлено по просьбе пользователя)

    // Ищем заказы с точным или частичным совпадением номера
    const { data: phoneEvents } = await supabase
        .from('raw_order_events')
        .select('retailcrm_order_id, phone, phone_normalized, additional_phone, additional_phone_normalized, manager_id, occurred_at')
        .or(`phone_normalized.eq.${normalized},additional_phone_normalized.eq.${normalized},phone_normalized.like.%${suffix},additional_phone_normalized.like.%${suffix}`)
        .order('occurred_at', { ascending: false })
        .limit(100);

    if (!phoneEvents || phoneEvents.length === 0) return [];

    // Группируем по заказу и берём последнее событие
    const orderMap = new Map<number, OrderCandidate>();

    for (const event of phoneEvents) {
        const orderId = event.retailcrm_order_id;

        if (!orderMap.has(orderId)) {
            orderMap.set(orderId, {
                retailcrm_order_id: orderId,
                phone: event.phone,
                additional_phone: event.additional_phone,
                manager_id: event.manager_id,
                last_event_at: event.occurred_at
            });
        }
    }

    return Array.from(orderMap.values());
}

/**
 * Матчит один звонок с заказами
 */
export async function matchCallToOrders(call: RawCall): Promise<MatchResult[]> {
    const matches: MatchResult[] = [];

    // Определяем номер клиента (зависит от направления)
    const clientPhone = call.direction === 'incoming'
        ? call.from_number
        : call.to_number;

    const clientPhoneNorm = normalizePhone(clientPhone);
    if (!clientPhoneNorm) return [];

    // Находим кандидатов
    const candidates = await findOrderCandidatesByPhone(clientPhone);

    for (const order of candidates) {
        const factors = {
            phone_match: false,
            partial_phone_match: false,
            time_diff_sec: null as number | null,
            manager_match: false,
            direction: call.direction
        };

        // Сравниваем по последним 7 цифрам (как договаривались)
        const callSuffix = clientPhoneNorm.replace(/\D/g, '').slice(-7);
        const orderPhoneSuffix = order.phone ? normalizePhone(order.phone)?.replace(/\D/g, '').slice(-7) : null;
        const orderAdditionalSuffix = order.additional_phone ? normalizePhone(order.additional_phone)?.replace(/\D/g, '').slice(-7) : null;

        const phoneMatch = callSuffix === orderPhoneSuffix || callSuffix === orderAdditionalSuffix;

        factors.phone_match = phoneMatch;
        factors.partial_phone_match = phoneMatch;

        // Вычисляем разницу во времени
        if (order.last_event_at) {
            const callTime = new Date(call.started_at).getTime();
            const eventTime = new Date(order.last_event_at).getTime();
            factors.time_diff_sec = Math.abs(callTime - eventTime) / 1000;
        }

        // Определяем confidence на основе времени
        let confidence = 0;
        let matchType: MatchResult['match_type'] = 'by_partial_phone';
        let explanation = '';

        if (!phoneMatch) continue; // Пропускаем, если нет совпадения

        // Правило 1: Совпадение + временное окно ≤ 5 минут
        if (factors.time_diff_sec !== null && factors.time_diff_sec <= 300) {
            confidence = 0.95;
            matchType = 'by_phone_time';
            explanation = `Совпадение последних 7 цифр, звонок через ${Math.round(factors.time_diff_sec)} сек после события`;
        }
        // Правило 2: Совпадение + временное окно ≤ 30 минут
        else if (factors.time_diff_sec !== null && factors.time_diff_sec <= 1800) {
            confidence = 0.85;
            matchType = 'by_phone_time';
            explanation = `Совпадение последних 7 цифр, звонок через ${Math.round(factors.time_diff_sec / 60)} мин после события`;
        }
        // Правило 3: Совпадение без временной привязки
        else {
            confidence = 0.70;
            matchType = 'by_phone_manager';
            explanation = `Совпадение последних 7 цифр номера`;
        }

        // Добавляем матч (минимальный порог 0.70)
        if (confidence >= 0.70) {
            matches.push({
                telphin_call_id: call.telphin_call_id,
                retailcrm_order_id: order.retailcrm_order_id,
                match_type: matchType,
                confidence_score: confidence,
                explanation,
                matching_factors: factors
            });
        }
    }

    // --- FALLBACK: LAST 4 DIGITS (Tricky/Local numbers) ---
    // If no good matches found, try looser search locally against the candidates we already have? 
    // No, candidates were fetched by last 7. 
    // If we want last 4, we need to fetch candidates by last 4. 
    // fetching by last 4 might return TOO MANY candidates.
    // Let's rely on the user feedback: "matches are few".
    // Maybe we just log "Potential matches by 4 digits"?
    // OR: Maybe the normalization is stripping too much or too little?
    // Let's stick to 7 digits for safety but ensure we check `phone` AND `additional_phone` properly. (Already done).

    // --- DEBUGGING LOW MATCHES ---
    // If we have 0 matches, let's look for "Similar" numbers?
    // Current logic: `callSuffix === orderPhoneSuffix`.
    // Maybe off by one digit? Levenshtein?
    // For now, let's LOWER the threshold for "By Time" if the number matches PARTIALLY?
    // No, Number match is prerequisite.

    // Maybe the 'candidates' query is too strict?
    // .or(`phone_normalized.like.%${suffix}...`)

    // Let's return what we have.


    // Сортируем по убыванию confidence
    return matches.sort((a, b) => b.confidence_score - a.confidence_score);
}

/**
 * Сохраняет матчи в БД
 */
export async function saveMatches(matches: MatchResult[]): Promise<void> {
    if (matches.length === 0) return;

    const records = matches.map(m => ({
        telphin_call_id: m.telphin_call_id,
        retailcrm_order_id: m.retailcrm_order_id,
        match_type: m.match_type,
        confidence_score: m.confidence_score,
        explanation: m.explanation,
        matching_factors: m.matching_factors,
        rule_id: 'heuristic_v1'
    }));

    const { error } = await supabase
        .from('call_order_matches')
        .upsert(records, {
            onConflict: 'telphin_call_id,retailcrm_order_id',
            ignoreDuplicates: false
        });

    if (error) {
        console.error('Error saving matches:', error);
        throw error;
    }
}

/**
 * Обрабатывает все звонки без матчей
 */
/**
 * Обрабатывает все звонки без матчей используя SQL функцию для производительности
 */
export async function processUnmatchedCalls(limit: number = 100): Promise<number> {
    console.log(`[Matching] Starting SQL-based matching process (limit: ${limit})...`);

    try {
        // 1. Trigger the SQL matcher function
        // This function finds matches and returns them
        const { data: matches, error } = await supabase.rpc('match_calls_to_orders', {
            batch_limit: limit
        });

        if (error) {
            console.error('[Matching] SQL Function Error:', error);
            throw error;
        }

        if (!matches || matches.length === 0) {
            console.log('[Matching] No new matches found.');
            return 0;
        }

        console.log(`[Matching] SQL function returned ${matches.length} potential matches.`);

        // 2. Save the results
        // match_calls_to_orders returns the full structure needed for saveMatches
        await saveMatches(matches as MatchResult[]);

        console.log(`[Matching] Successfully saved ${matches.length} matches.`);
        return matches.length;

    } catch (e: any) {
        console.error('[Matching] Fatal error in SQL matching:', e.message);
        throw e;
    }
}
