/**
 * ОКК-Движок оценки заказов v2
 * Колонки точно по Google Spreadsheet "Чек-лист менеджеры ОП"
 *
 * Ответственность:
 *   СЕМЁН  (collectFacts)    — факты без AI (данные, поля, звонки, время)
 *   МАКСИМ (evaluateScript)  — AI-оценка скрипта по 12 пунктам через GPT
 *   ИГОРЬ  (checkSLA)       — SLA без AI (просрочки, статус, контакт)
 */

import { supabase } from '@/utils/supabase';
import OpenAI from 'openai';

let _openai: OpenAI | null = null;
function getOpenAI() {
    if (!_openai) _openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    return _openai;
}

// ═══════════════════════════════════════════════════════
// СЕМЁН: Сбор фактов (без AI)
// Заполняет: Общая информация, Заполнение полей, Оценка разговоров
// ═══════════════════════════════════════════════════════
export async function collectFacts(orderId: number) {
    // Данные заказа
    const { data: order } = await supabase
        .from('orders')
        .select('raw_payload, created_at, status, updated_at, manager_id')
        .eq('order_id', orderId)
        .single();

    const raw = (order?.raw_payload as any) || {};

    // Все звонки по заказу
    const { data: callMatches } = await supabase
        .from('call_order_matches')
        .select('telphin_call_id, raw_telphin_calls(started_at, duration_sec, recording_url, direction, transcript)')
        .eq('retailcrm_order_id', orderId);

    const calls = (callMatches || []).map((m: any) => m.raw_telphin_calls).filter(Boolean);
    const outgoing = calls.filter((c: any) => c.direction === 'outgoing');
    const connectedCalls = calls.filter((c: any) => (c.duration_sec || 0) > 15);

    // Z: Статус звонков
    const calls_status = connectedCalls.length > 0 ? 'Дозвон есть' : outgoing.length > 0 ? 'Попытки без ответа' : 'Нет звонков';

    // AA: Общая длительность
    const totalSec = calls.reduce((s: number, c: any) => s + (c.duration_sec || 0), 0);
    const calls_total_duration = totalSec > 0 ? `${Math.floor(totalSec / 60)}м ${totalSec % 60}с` : '0с';

    // AB: Кол-во попыток
    const calls_attempts_count = outgoing.length;

    // AC: Оцененных звонков (с транскрипцией)
    const calls_evaluated_count = calls.filter((c: any) => !!c.transcript).length;

    // N: ТЗ получено — ищем в комментариях или полях
    const tzFields = ['tz', 'technical_specification', 'width', 'height', 'depth', 'temperature'];
    const tz_received = tzFields.some(f => !!(raw?.customFields?.[f]));

    // O: Покупатель заполнен
    const field_buyer_filled = !!(raw?.company?.name || raw?.contact?.name || raw?.customer?.firstName);

    // P: Категория товара
    const field_product_category = !!(raw?.customFields?.tovarnaya_kategoriya || raw?.customFields?.product_category);

    // Q: Контактные данные
    const field_contact_data = !!(raw?.phone || raw?.email || raw?.contact?.phones?.length);

    // R: Релевантный номер найден — есть ли звонки вообще
    const relevant_number_found = outgoing.length > 0;

    // S: Ожидаемая сумма
    const field_expected_amount = !!(raw?.customFields?.expected_amount || raw?.customFields?.ozhidaemaya_summa || (raw?.totalSumm || 0) > 0);

    // T: Форма закупки
    const field_purchase_form = !!(raw?.customFields?.purchase_form || raw?.customFields?.forma_zakupki);

    // U: Сфера деятельности
    const field_sphere_correct = !!(raw?.customFields?.sphere_of_activity || raw?.customFields?.sfera_deyatelnosti || raw?.customFields?.industry);

    // V: Обязательные комментарии — есть ли события с комментариями
    const { count: commentCount } = await supabase
        .from('raw_order_events')
        .select('event_id', { count: 'exact', head: true })
        .eq('retailcrm_order_id', orderId)
        .ilike('event_type', '%comment%');
    const mandatory_comments = (commentCount || 0) > 0;

    // W: Письма при неответе
    const missedCalls = outgoing.filter((c: any) => (c.duration_sec || 0) === 0);
    let email_sent_no_answer = false;
    if (missedCalls.length > 0) {
        const { count: emailCount } = await supabase
            .from('raw_order_events')
            .select('event_id', { count: 'exact', head: true })
            .eq('retailcrm_order_id', orderId)
            .ilike('event_type', '%email%');
        email_sent_no_answer = (emailCount || 0) > 0;
    } else {
        email_sent_no_answer = true; // написать письмо нужно только если не дозвонился
    }

    // Склейка истории всех транскрипций для GPT (Максим)
    const transcript_history = calls
        .filter((c: any) => !!c.transcript)
        .sort((a: any, b: any) => new Date(a.started_at).getTime() - new Date(b.started_at).getTime())
        .map((c: any) => {
            const date = new Date(c.started_at).toLocaleString('ru-RU');
            const dir = c.direction === 'outgoing' ? 'ИСХОДЯЩИЙ' : 'ВХОДЯЩИЙ';
            return `--- ${dir} ЗВОНОК (${date}, ${c.duration_sec} сек) ---\n${c.transcript}`;
        })
        .join('\n\n');

    // G: lead_received_at
    const lead_received_at = order?.created_at || null;

    // H: дата первой попытки звонка
    const sortedOutgoing = [...outgoing].sort((a: any, b: any) => new Date(a.started_at).getTime() - new Date(b.started_at).getTime());
    const first_contact_attempt_at = sortedOutgoing[0]?.started_at || null;

    // I: время ожидания
    let time_to_first_contact: string | null = null;
    if (lead_received_at && first_contact_attempt_at) {
        const diffMs = new Date(first_contact_attempt_at).getTime() - new Date(lead_received_at).getTime();
        const diffH = Math.floor(diffMs / (1000 * 60 * 60));
        const diffM = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
        time_to_first_contact = diffMs < 0 ? '< 0' : `${diffH}ч ${diffM}м`;
    }

    return {
        // Идентификация
        order_id: orderId,
        manager_id: order?.manager_id || null,
        order_status: order?.status || null,
        lead_received_at,
        first_contact_attempt_at,
        time_to_first_contact,
        // Заполнение полей
        tz_received,
        field_buyer_filled,
        field_product_category,
        field_contact_data,
        relevant_number_found,
        field_expected_amount,
        field_purchase_form,
        field_sphere_correct,
        mandatory_comments,
        email_sent_no_answer,
        // Оценка разговоров
        calls_status,
        calls_total_duration,
        calls_attempts_count,
        calls_evaluated_count,
        // Для дальнейшей обработки
        _order: order,
        _transcript: transcript_history,
    };
}

// ═══════════════════════════════════════════════════════
// ИГОРЬ: Проверка SLA (без AI)
// Заполняет: Статус и время ожидания лида (col J-M)
// ═══════════════════════════════════════════════════════
export async function checkSLA(orderId: number, order: any, leadReceivedAt: string | null) {
    const now = new Date();
    const updatedAt = new Date(order?.updated_at || Date.now());

    // J: Лид в работе менее суток с даты поступления
    let lead_in_work_lt_1_day: boolean | null = null;
    if (leadReceivedAt) {
        const diffH = (now.getTime() - new Date(leadReceivedAt).getTime()) / (1000 * 60 * 60);
        lead_in_work_lt_1_day = diffH <= 24;
    }

    // K: Дата следующего контакта не просрочена
    const nextContactRaw = (order?.raw_payload as any)?.customFields?.next_contact_date
        || (order?.raw_payload as any)?.customFields?.data_kontakta;
    let next_contact_not_overdue = true;
    if (nextContactRaw) {
        next_contact_not_overdue = new Date(nextContactRaw) >= now;
    }

    // L: Лид в работе менее суток с даты получения ТЗ (если ТЗ есть — новый отсчёт)
    // Упрощение: берём updated_at как прокси
    const lead_in_work_lt_1_day_after_tz = lead_in_work_lt_1_day;

    // M: Сделка в одном статусе менее 5 дней
    const daysInStatus = (now.getTime() - updatedAt.getTime()) / (1000 * 60 * 60 * 24);
    const deal_in_status_lt_5_days = daysInStatus < 5;

    return {
        lead_in_work_lt_1_day,
        next_contact_not_overdue,
        lead_in_work_lt_1_day_after_tz,
        deal_in_status_lt_5_days,
        _days_in_status: Math.round(daysInStatus),
    };
}

// ═══════════════════════════════════════════════════════
// МАКСИМ: AI-оценка скрипта (12 пунктов как в таблице)
// Заполняет: Установление контакта, Выявление потребностей,
//            Работа с возражениями, В конце диалога, Ведение диалога
// ═══════════════════════════════════════════════════════
export async function evaluateScript(transcript: string) {
    const empty = {
        script_greeting: null as boolean | null,
        script_call_purpose: null as boolean | null,
        script_company_info: null as boolean | null,
        script_deadlines: null as boolean | null,
        script_tz_confirmed: null as boolean | null,
        script_objection_general: null as boolean | null,
        script_objection_delays: null as boolean | null,
        script_offer_best_tech: null as boolean | null,
        script_offer_best_terms: null as boolean | null,
        script_offer_best_price: null as boolean | null,
        script_cross_sell: null as boolean | null,
        script_next_step_agreed: null as boolean | null,
        script_dialogue_management: null as boolean | null,
        script_confident_speech: null as boolean | null,
        script_score_pct: null as number | null,
        evaluator_comment: null as string | null,
    };

    if (!transcript || transcript.length < 50) return empty;

    try {
        const openai = getOpenAI();
        const res = await openai.chat.completions.create({
            model: 'gpt-4o-mini',
            temperature: 0.1,
            response_format: { type: 'json_object' },
            messages: [
                {
                    role: 'system',
                    content: `Ты — эксперт ОКК отдела продаж промышленного оборудования. 
Тебе предоставлена ИСТОРИЯ ПЕРЕГОВОРОВ по одному заказу (может быть как 1 звонок, так и несколько).
Проверь выполнение чек-листа по ВСЕЙ ИСТОРИИ. Если пункт был выполнен хотя бы в одном из звонков (например, боль выявили в первом звонке, а закрыли на следующий шаг во втором) — ставь true.

Чек-лист (true = выполнено, false = не выполнено):
{
  "script_greeting": <В любом из звонков было приветствие и представление>,
  "script_call_purpose": <Озвучена цель звонка / привязка к шагу>,
  "script_company_info": <Выявлено: чем занимается организация, бюджет, НДС и т.д.>,
  "script_deadlines": <Выяснены сроки готовности / поставки>,
  "script_tz_confirmed": <Убедился, что параметры заказа понятны>,
  "script_objection_general": <Работа с возражениями (если были)>,
  "script_objection_delays": <Если клиент медлит — выяснил причину>,
  "script_offer_best_tech": <Аргументация по тех. характеристикам>,
  "script_offer_best_terms": <Аргументация по срокам>,
  "script_offer_best_price": <Аргументация по цене>,
  "script_cross_sell": <Информирование о доп. оборудовании / кросс-продажа>,
  "script_next_step_agreed": <Договорённость о конкретном следующем действии>,
  "script_dialogue_management": <Менеджер вел инициативу во всех звонках>,
  "script_confident_speech": <Уверенная, грамотная речь в целом>,
  "script_score_pct": <итоговый % выполнения чек-листа от 0 до 100>,
  "evaluator_comment": "<краткий вывод: был ли прогресс по звонкам, 1-2 предложения>"
}`
                },
                {
                    role: 'user',
                    content: `История звонков:\n${transcript.substring(0, 7000)}`
                }
            ]
        });

        const parsed = JSON.parse(res.choices[0].message.content || '{}');
        return {
            script_greeting: parsed.script_greeting ?? null,
            script_call_purpose: parsed.script_call_purpose ?? null,
            script_company_info: parsed.script_company_info ?? null,
            script_deadlines: parsed.script_deadlines ?? null,
            script_tz_confirmed: parsed.script_tz_confirmed ?? null,
            script_objection_general: parsed.script_objection_general ?? null,
            script_objection_delays: parsed.script_objection_delays ?? null,
            script_offer_best_tech: parsed.script_offer_best_tech ?? null,
            script_offer_best_terms: parsed.script_offer_best_terms ?? null,
            script_offer_best_price: parsed.script_offer_best_price ?? null,
            script_cross_sell: parsed.script_cross_sell ?? null,
            script_next_step_agreed: parsed.script_next_step_agreed ?? null,
            script_dialogue_management: parsed.script_dialogue_management ?? null,
            script_confident_speech: parsed.script_confident_speech ?? null,
            script_score_pct: typeof parsed.script_score_pct === 'number' ? Math.min(100, Math.max(0, parsed.script_score_pct)) : null,
            evaluator_comment: parsed.evaluator_comment ?? null,
        };
    } catch (e) {
        console.error('[Максим/GPT] Script evaluation failed:', e);
        return empty;
    }
}

// ═══════════════════════════════════════════════════════
// Расчёт итогового % (X, Y, AR, AS)
// ═══════════════════════════════════════════════════════
function calcScores(data: Record<string, any>) {
    // Оценка заполнения сделки (col Y: % правил заполнения/ведения)
    const dealChecks = [
        data.tz_received,
        data.field_buyer_filled,
        data.field_product_category,
        data.field_contact_data,
        data.relevant_number_found,
        data.field_expected_amount,
        data.field_purchase_form,
        data.field_sphere_correct,
        data.mandatory_comments,
        data.email_sent_no_answer,
        data.lead_in_work_lt_1_day,
        data.next_contact_not_overdue,
        data.deal_in_status_lt_5_days,
    ].filter(v => v !== null && v !== undefined);

    const dealPassed = dealChecks.filter(Boolean).length;
    const deal_score = dealChecks.length > 0 ? dealPassed : 0;
    const deal_score_pct = dealChecks.length > 0 ? Math.round((dealPassed / dealChecks.length) * 100) : null;

    // Оценка скрипта (col AS: % скрипта) — берём из GPT или считаем вручную
    const script_score_pct = data.script_score_pct ?? null;
    const script_score = script_score_pct !== null ? Math.round((script_score_pct / 100) * 14) : null; // из 14 пунктов

    // Общий % (среднее двух оценок)
    let total_score: number | null = null;
    if (deal_score_pct !== null && script_score_pct !== null) {
        total_score = Math.round((deal_score_pct + script_score_pct) / 2);
    } else if (deal_score_pct !== null) {
        total_score = deal_score_pct;
    } else if (script_score_pct !== null) {
        total_score = script_score_pct;
    }

    return { deal_score, deal_score_pct, script_score, total_score };
}

// ═══════════════════════════════════════════════════════
// ГЛАВНЫЙ МЕТОД: оценить один заказ
// ═══════════════════════════════════════════════════════
export async function evaluateOrder(orderId: number): Promise<void> {
    console.log(`[ОКК] Оцениваем заказ #${orderId}`);

    // Семён собирает факты
    const facts = await collectFacts(orderId);

    // Игорь проверяет SLA
    const sla = await checkSLA(orderId, facts._order, facts.lead_received_at);

    // Максим оценивает скрипт
    const script = await evaluateScript(facts._transcript);

    // Максим считает итог
    const allData = { ...facts, ...sla, ...script };
    const scores = calcScores(allData);

    const record = {
        order_id: orderId,
        manager_id: facts.manager_id,
        order_status: facts.order_status,
        // G-I
        lead_received_at: facts.lead_received_at,
        first_contact_attempt_at: facts.first_contact_attempt_at,
        time_to_first_contact: facts.time_to_first_contact,
        // J-M (Игорь)
        lead_in_work_lt_1_day: sla.lead_in_work_lt_1_day,
        next_contact_not_overdue: sla.next_contact_not_overdue,
        lead_in_work_lt_1_day_after_tz: sla.lead_in_work_lt_1_day_after_tz,
        deal_in_status_lt_5_days: sla.deal_in_status_lt_5_days,
        // N-W (Семён)
        tz_received: facts.tz_received,
        field_buyer_filled: facts.field_buyer_filled,
        field_product_category: facts.field_product_category,
        field_contact_data: facts.field_contact_data,
        relevant_number_found: facts.relevant_number_found,
        field_expected_amount: facts.field_expected_amount,
        field_purchase_form: facts.field_purchase_form,
        field_sphere_correct: facts.field_sphere_correct,
        mandatory_comments: facts.mandatory_comments,
        email_sent_no_answer: facts.email_sent_no_answer,
        // Z-AC (Семён)
        calls_status: facts.calls_status,
        calls_total_duration: facts.calls_total_duration,
        calls_attempts_count: facts.calls_attempts_count,
        calls_evaluated_count: facts.calls_evaluated_count,
        // AD-AQ (Максим/GPT)
        script_greeting: script.script_greeting,
        script_call_purpose: script.script_call_purpose,
        script_company_info: script.script_company_info,
        script_deadlines: script.script_deadlines,
        script_tz_confirmed: script.script_tz_confirmed,
        script_objection_general: script.script_objection_general,
        script_objection_delays: script.script_objection_delays,
        script_offer_best_tech: script.script_offer_best_tech,
        script_offer_best_terms: script.script_offer_best_terms,
        script_offer_best_price: script.script_offer_best_price,
        script_cross_sell: script.script_cross_sell,
        script_next_step_agreed: script.script_next_step_agreed,
        script_dialogue_management: script.script_dialogue_management,
        script_confident_speech: script.script_confident_speech,
        // X-Y, AR-AS (Максим — итог)
        deal_score: scores.deal_score,
        deal_score_pct: scores.deal_score_pct,
        script_score: scores.script_score,
        script_score_pct: script.script_score_pct,
        total_score: scores.total_score,
        evaluator_comment: script.evaluator_comment,
        evaluated_by: 'maxim',
        eval_date: new Date().toISOString(),
    };

    const { error } = await supabase
        .from('okk_order_scores')
        .upsert(record, { onConflict: 'order_id' });

    if (error) {
        console.error(`[ОКК] Ошибка записи для #${orderId}:`, error.message);
        throw error;
    }
    console.log(`[ОКК] #${orderId} → сделка ${scores.deal_score_pct}%, скрипт ${script.script_score_pct ?? '—'}%, итог ${scores.total_score}%`);
}

// ═══════════════════════════════════════════════════════
// ПОЛНЫЙ ПРОГОН
// ═══════════════════════════════════════════════════════
export async function runFullEvaluation(params?: { limit?: number; specificOrderId?: number }): Promise<{ processed: number; errors: number }> {
    let ordersToProcess: { order_id: number }[] = [];

    if (params?.specificOrderId) {
        ordersToProcess = [{ order_id: params.specificOrderId }];
    } else {
        const { data: settings } = await supabase
            .from('status_settings')
            .select('code')
            .eq('is_working', true);

        const statusCodes: string[] = (settings || []).map((s: any) => s.code);
        if (statusCodes.length === 0) return { processed: 0, errors: 0 };

        const { data: orders } = await supabase
            .from('orders')
            .select('order_id')
            .in('status', statusCodes)
            .lt('order_id', 99900000)
            .order('created_at', { ascending: false })
            .limit(params?.limit || 100);

        ordersToProcess = orders || [];
    }

    let processed = 0, errors = 0;
    for (const order of ordersToProcess) {
        try {
            await evaluateOrder(order.order_id);
            processed++;
            // Небольшая задержка чтобы не спамить OpenAI/Supabase
            if (processed % 5 === 0) await new Promise(r => setTimeout(r, 800));
        } catch (e) {
            console.error(`[ОКК] Ошибка для #${order.order_id}:`, e);
            errors++;
        }
    }
    return { processed, errors };
}
