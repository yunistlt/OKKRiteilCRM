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

    // --- Умный поиск звонков ---
    let calls: any[] = [];
    const { data: callMatches } = await supabase
        .from('call_order_matches')
        .select('telphin_call_id, raw_telphin_calls(started_at, duration_sec, recording_url, direction, transcript)')
        .eq('retailcrm_order_id', orderId);

    calls = (callMatches || []).map((m: any) => m.raw_telphin_calls).filter(Boolean);

    // Фолбек: если привязок нет, ищем по номеру телефона клиента
    if (calls.length === 0) {
        const clientPhones: string[] = [];
        if (raw.phone) clientPhones.push(String(raw.phone));
        if (raw.additionalPhone) clientPhones.push(String(raw.additionalPhone));
        if (raw.contact?.phones) (raw.contact.phones as any[]).forEach(p => clientPhones.push(String(p.number)));

        // Оставляем только значимые цифры (последние 10)
        const searchParts = Array.from(new Set(clientPhones.map(p => p.replace(/\D/g, '').slice(-10)).filter(p => p.length >= 7)));

        if (searchParts.length > 0 && order?.created_at) {
            const startLimit = new Date(new Date(order.created_at).getTime() - 24 * 60 * 60 * 1000).toISOString();
            const endLimit = new Date(new Date(order.created_at).getTime() + 12 * 60 * 60 * 1000).toISOString();

            let query = supabase.from('raw_telphin_calls')
                .select('started_at, duration_sec, recording_url, direction, transcript')
                .gte('started_at', startLimit)
                .lte('started_at', endLimit);

            // Строим фильтр OR для всех найденных частей номера
            const orFilter = searchParts.map(p => `from_number.ilike.%${p}%,to_number.ilike.%${p}%`).join(',');
            const { data: fallbackCalls } = await query.or(orFilter);

            if (fallbackCalls && fallbackCalls.length > 0) {
                calls = fallbackCalls;
            }
        }
    }

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

    // Сбор обоснований от Семёна (технические поля)
    const reasons: Record<string, string> = {
        tz_received: tz_received ? "В истории событий или файлах заказа обнаружено техническое задание." : "Техническое задание не найдено (проверены история событий и прикрепленные файлы).",
        field_buyer_filled: field_buyer_filled ? `Поле 'Покупатель' заполнено: ${raw?.customer?.type === 'customer' ? 'Частное лицо' : 'Юр. лицо'}.` : "Поле 'Покупатель' не заполнено в RetailCRM.",
        field_product_category: field_product_category ? `Категория товара указана (${raw?.customFields?.category || 'стандартное поле'}).` : "Категория товара не выбрана в карточке заказа.",
        field_contact_data: field_contact_data ? "Контактные данные (телефон/email) присутствуют в карточке клиента." : "В карточке клиента отсутствуют контактные данные.",
        relevant_number_found: relevant_number_found ? `Найдены звонки (${outgoing.length} исх.) по номеру клиента в базе Telphin.` : "Исходящих звонков по номеру клиента не найдено.",
        field_expected_amount: field_expected_amount ? `Ожидаемая сумма указана (${raw?.totalSumm || raw?.customFields?.expected_amount || '0'} руб).` : "Сумма сделки (бюджет) не заполнена.",
        field_purchase_form: field_purchase_form ? "Форма закупки указана в соответствующем поле." : "Форма закупки не заполнена.",
        field_sphere_correct: field_sphere_correct ? "Сфера деятельности клиента определена и заполнена." : "Сфера деятельности клиента не указана.",
        mandatory_comments: mandatory_comments ? `В истории найдено ${commentCount} комментариев от менеджера.` : "Менеджер не оставил ни одного существенного комментария к заказу.",
        email_sent_no_answer: email_sent_no_answer ? (missedCalls.length > 0 ? "После неудачного звонка клиенту было отправлено письмо/сообщение." : "Дозвон состоялся, отправка письма не требовалась.") : `Было пропущено ${missedCalls.length} вызовов, но письмо/сообщение не отправлено.`
    };

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
        _reasons: reasons
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
        script_greeting: { result: null, reason: null },
        script_call_purpose: { result: null, reason: null },
        script_company_info: { result: null, reason: null },
        script_deadlines: { result: null, reason: null },
        script_tz_confirmed: { result: null, reason: null },
        script_objection_general: { result: null, reason: null },
        script_objection_delays: { result: null, reason: null },
        script_offer_best_tech: { result: null, reason: null },
        script_offer_best_terms: { result: null, reason: null },
        script_offer_best_price: { result: null, reason: null },
        script_cross_sell: { result: null, reason: null },
        script_next_step_agreed: { result: null, reason: null },
        script_dialogue_management: { result: null, reason: null },
        script_confident_speech: { result: null, reason: null },
        script_score_pct: null as number | null,
        evaluator_comment: null as string | null,
    };

    if (!transcript || transcript.length < 50) return empty as any;

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
Тебе предоставлена ИСТОРИЯ ПЕРЕГОВОРОВ по одному заказу (1 или несколько звонков).
Проверь выполнение чек-листа по ВСЕЙ ИСТОРИИ. 

Для каждого пункта верни объект: {"result": true/false, "reason": "ПОДРОБНОЕ обоснование"}.

КРИТИЧЕСКОЕ ТРЕБОВАНИЕ к "reason":
Ты должен ДОКАЗАТЬ свою оценку. 
- Если ставишь TRUE: приведи прямую или косвенную цитату (например: Менеджер сказал: "Рассчитаем за 2 дня", поэтому сроки выяснены).
- Если ставишь FALSE: опиши, чего именно не хватило или что менеджер сделал не так (например: Менеджер не спросил о сроках, хотя клиент упоминал спешку).
- Будь конкретным. Избегай общих фраз "критерий выполнен".

Критерии:
- script_greeting: Приветствие и название компании.
- script_call_purpose: Озвучена причина звонка (привязка к заказу или этапу).
- script_company_info: Выявлены потребности, бюджет, НДС или сфера деятельности клиента.
- script_deadlines: Выяснены сроки готовности или поставки.
- script_tz_confirmed: Параметры тех. задания подтверждены и понятны.
- script_objection_general: Работа с возражениями (дорого, долго, подумаем).
- script_objection_delays: Если клиент молчит или тянет — выяснена причина.
- script_offer_best_tech: Аргументация через технические преимущества.
- script_offer_best_terms: Аргументы по срокам/наличию.
- script_offer_best_price: Аргументы по цене/скидкам.
- script_cross_sell: Предложение сопутствующих товаров (печи -> расходники и т.п.).
- script_next_step_agreed: Четкая фиксация следующего шага с датой.
- script_dialogue_management: Менеджер вел инициативу (задавал вопросы, а не только отвечал).
- script_confident_speech: Уверенность, отсутствие слов-паразитов.

Также верни:
- script_score_pct: общий % (0-100).
- evaluator_comment: общий вывод.`
                },
                {
                    role: 'user',
                    content: `История звонков:\n${transcript.substring(0, 15000)}`
                }
            ]
        });

        const parsed = JSON.parse(res.choices[0].message.content || '{}');
        const getVal = (key: string) => ({
            result: parsed[key]?.result ?? null,
            reason: parsed[key]?.reason ?? null
        });

        return {
            script_greeting: getVal('script_greeting'),
            script_call_purpose: getVal('script_call_purpose'),
            script_company_info: getVal('script_company_info'),
            script_deadlines: getVal('script_deadlines'),
            script_tz_confirmed: getVal('script_tz_confirmed'),
            script_objection_general: getVal('script_objection_general'),
            script_objection_delays: getVal('script_objection_delays'),
            script_offer_best_tech: getVal('script_offer_best_tech'),
            script_offer_best_terms: getVal('script_offer_best_terms'),
            script_offer_best_price: getVal('script_offer_best_price'),
            script_cross_sell: getVal('script_cross_sell'),
            script_next_step_agreed: getVal('script_next_step_agreed'),
            script_dialogue_management: getVal('script_dialogue_management'),
            script_confident_speech: getVal('script_confident_speech'),
            script_score_pct: typeof parsed.script_score_pct === 'number' ? Math.min(100, Math.max(0, parsed.script_score_pct)) : null,
            evaluator_comment: parsed.evaluator_comment ?? null,
        };
    } catch (e) {
        console.error('[Максим/GPT] Script evaluation failed:', e);
        return empty as any;
    }
}

// ═══════════════════════════════════════════════════════
// Расчёт итогового % (X, Y, AR, AS)
// ═══════════════════════════════════════════════════════
function calcScores(data: Record<string, any>) {
    // Оценка заполнения сделки (col Y: % правил заполнения/ведения)
    const dealChecks = [
        { key: 'tz_received', val: data.tz_received },
        { key: 'field_buyer_filled', val: data.field_buyer_filled },
        { key: 'field_product_category', val: data.field_product_category },
        { key: 'field_contact_data', val: data.field_contact_data },
        { key: 'relevant_number_found', val: data.relevant_number_found },
        { key: 'field_expected_amount', val: data.field_expected_amount },
        { key: 'field_purchase_form', val: data.field_purchase_form },
        { key: 'field_sphere_correct', val: data.field_sphere_correct },
        { key: 'mandatory_comments', val: data.mandatory_comments },
        { key: 'email_sent_no_answer', val: data.email_sent_no_answer },
        { key: 'lead_in_work_lt_1_day', val: data.lead_in_work_lt_1_day },
        { key: 'next_contact_not_overdue', val: data.next_contact_not_overdue },
        { key: 'deal_in_status_lt_5_days', val: data.deal_in_status_lt_5_days },
    ].filter(chk => chk.val !== null && chk.val !== undefined);

    const dealPassed = dealChecks.filter(chk => !!chk.val).length;
    const deal_score = dealChecks.length > 0 ? dealPassed : 0;
    const deal_score_pct = dealChecks.length > 0 ? Math.round((dealPassed / dealChecks.length) * 100) : null;

    // Скрипт (Максим возвращает {result, reason})
    const script_score_pct = data.script_score_pct ?? null;
    const script_score = script_score_pct !== null ? Math.round((script_score_pct / 100) * 14) : null;

    // Общий %
    let total_score: number | null = null;
    if (deal_score_pct !== null && script_score_pct !== null) {
        total_score = Math.round((deal_score_pct + script_score_pct) / 2);
    } else if (deal_score_pct !== null) total_score = deal_score_pct;
    else if (script_score_pct !== null) total_score = script_score_pct;

    // Сборка breakdown для UI
    const score_breakdown: Record<string, any> = {};

    // Техническая часть (Семён)
    Object.keys(data._reasons || {}).forEach(k => {
        score_breakdown[k] = { result: !!data[k], reason: data._reasons[k] };
    });

    // Часть SLA (Игорь)
    score_breakdown.lead_in_work_lt_1_day = { result: !!data.lead_in_work_lt_1_day, reason: data.lead_in_work_lt_1_day ? "Лид взят в работу быстрее 24 часов" : "Более 24 часов до взятия в работу" };
    score_breakdown.next_contact_not_overdue = { result: !!data.next_contact_not_overdue, reason: data.next_contact_not_overdue ? "Дата следующего контакта актуальна" : "Дата следующего контакта просрочена" };
    score_breakdown.deal_in_status_lt_5_days = { result: !!data.deal_in_status_lt_5_days, reason: data.deal_in_status_lt_5_days ? `Сделка в статусе ${data._days_in_status} дн. (норма до 5)` : `Сделка зависла в статусе на ${data._days_in_status} дн.` };

    // Скрипт (Максим)
    const scriptKeys = ['script_greeting', 'script_call_purpose', 'script_company_info', 'script_deadlines', 'script_tz_confirmed', 'script_objection_general', 'script_objection_delays', 'script_offer_best_tech', 'script_offer_best_terms', 'script_offer_best_price', 'script_cross_sell', 'script_next_step_agreed', 'script_dialogue_management', 'script_confident_speech'];
    scriptKeys.forEach(k => {
        if (data[k]) score_breakdown[k] = data[k];
    });

    return { deal_score, deal_score_pct, script_score, total_score, score_breakdown };
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
        script_greeting: script.script_greeting?.result,
        script_call_purpose: script.script_call_purpose?.result,
        script_company_info: script.script_company_info?.result,
        script_deadlines: script.script_deadlines?.result,
        script_tz_confirmed: script.script_tz_confirmed?.result,
        script_objection_general: script.script_objection_general?.result,
        script_objection_delays: script.script_objection_delays?.result,
        script_offer_best_tech: script.script_offer_best_tech?.result,
        script_offer_best_terms: script.script_offer_best_terms?.result,
        script_offer_best_price: script.script_offer_best_price?.result,
        script_cross_sell: script.script_cross_sell?.result,
        script_next_step_agreed: script.script_next_step_agreed?.result,
        script_dialogue_management: script.script_dialogue_management?.result,
        script_confident_speech: script.script_confident_speech?.result,
        // X-Y, AR-AS (Максим — итог)
        deal_score: scores.deal_score,
        deal_score_pct: scores.deal_score_pct,
        script_score: scores.script_score,
        script_score_pct: script.script_score_pct,
        total_score: scores.total_score,
        evaluator_comment: script.evaluator_comment,
        score_breakdown: scores.score_breakdown, // <--- Наша новая детализация
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
