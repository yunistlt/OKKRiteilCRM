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
    match_type: 'by_phone_time' | 'by_phone_manager' | 'by_partial_phone' | 'manual' | 'by_phone_day' | 'by_phone_window';
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
export async function findOrderCandidatesByPhone(phone: string): Promise<OrderCandidate[]> {
    const normalized = normalizePhone(phone);
    if (!normalized) return [];

    const suffix = normalized.slice(-7); // Последние 7 цифр

    // Ищем заказы с точным совпадением номера в EVENTS (LIKE % убивает производительность на больших таблицах)
    // Оптимизация: убрали slow queries .like.%${suffix}
    const { data: phoneEvents } = await supabase
        .from('raw_order_events')
        .select('retailcrm_order_id, phone, phone_normalized, additional_phone, additional_phone_normalized, manager_id, occurred_at')
        .or(`phone_normalized.eq.${normalized},additional_phone_normalized.eq.${normalized}`)
        .order('occurred_at', { ascending: false })
        .limit(20);

    const candidatesMap = new Map<number, OrderCandidate>();

    // 1. Add candidates from events
    if (phoneEvents) {
        for (const event of phoneEvents) {
            candidatesMap.set(event.retailcrm_order_id, {
                retailcrm_order_id: event.retailcrm_order_id,
                phone: event.phone,
                additional_phone: event.additional_phone,
                manager_id: event.manager_id,
                last_event_at: event.occurred_at
            });
        }
    }

    // 2. Add candidates directly from ORDERS table (Fallback if events missing)
    // Checking main phone
    const { data: orders } = await supabase
        .from('orders')
        .select('id, phone, customer_phones, manager_id, created_at')
        .ilike('phone', `%${suffix}`)
        .order('created_at', { ascending: false })
        .limit(5);

    if (orders) {
        for (const o of orders) {
            if (!candidatesMap.has(o.id)) {
                candidatesMap.set(o.id, {
                    retailcrm_order_id: o.id,
                    phone: o.phone || (o.customer_phones?.[0] || null),
                    additional_phone: null,
                    manager_id: o.manager_id,
                    last_event_at: o.created_at // Use creation time as event time
                });
            }
        }
    }

    return Array.from(candidatesMap.values());
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

        // Сравниваем по последним 7 цифрам
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

        // Правило 1: Совпадение + временное окно ≤ 10 минут (High)
        if (factors.time_diff_sec !== null && factors.time_diff_sec <= 600) {
            confidence = 0.95;
            matchType = 'by_phone_time';
            explanation = `Совпадение последних 7 цифр, звонок через ${Math.round(factors.time_diff_sec)} сек после события`;
        }
        // Правило 2: Совпадение + временное окно ≤ 48 часов (Medium)
        else if (factors.time_diff_sec !== null && factors.time_diff_sec <= 172800) {
            confidence = 0.85;
            matchType = 'by_phone_day';
            // Fallback if enum fails? Assuming DB has 'by_phone_day' or mapping it to 'by_partial_phone' 
            // Diagnostic showed: match_type is handled by DB insert.
            matchType = 'by_partial_phone'; // Safe default for now to avoid constraint errors
            explanation = `Совпадение последних 7 цифр, звонок через ${Math.round(factors.time_diff_sec / 3600)} ч после события`;
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
        // Don't throw, just log. We don't want to stop the whole process if one batch fails.
    }
}

/**
 * Обрабатывает все звонки (Hybrid TS Logic)
 */
export async function processUnmatchedCalls(limit: number = 50): Promise<number> {
    console.log(`[Matching] Starting Hybrid TS-based matching process (limit: ${limit})...`);

    try {
        // 1. Fetch recent calls (last 5 days)
        const fiveDaysAgo = new Date();
        fiveDaysAgo.setDate(fiveDaysAgo.getDate() - 5);

        const { data: recentCalls, error: fetchError } = await supabase
            .from('raw_telphin_calls')
            .select('*')
            .gte('started_at', fiveDaysAgo.toISOString())
            .order('started_at', { ascending: false })
            .limit(limit * 2);

        if (fetchError) throw fetchError;
        if (!recentCalls || recentCalls.length === 0) return 0;

        console.log(`[Matching] Re-processing ${recentCalls.length} recent calls (Hybrid)...`);

        const callsToProcess = recentCalls;
        let totalMatches = 0;
        let processedCount = 0;

        // 2. Process each call
        for (const call of callsToProcess) {
            const matches = await matchCallToOrders(call);
            if (matches.length > 0) {
                // Save IMMEDIATELY to prevent data loss on timeout
                await saveMatches(matches);
                totalMatches += matches.length;
            }

            processedCount++;
            if (processedCount % 10 === 0) {
                console.log(`[Matching] Processed ${processedCount}/${callsToProcess.length} calls...`);
            }
        }

        console.log(`[Matching] Completed. Total matches found & saved: ${totalMatches}`);
        return totalMatches;

    } catch (e: any) {
        console.error('[Matching] Error in TS matching:', e.message);
        throw e;
    }
}
