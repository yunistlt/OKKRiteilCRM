/**
 * ОКК-Движок оценки заказов v2
 * Колонки точно по Google Spreadsheet "Чек-лист менеджеры ОП"
 *
 * Ответственность:
 *   СЕМЁН  (collectFacts)    — факты без AI (данные, поля, звонки, время)
 *   МАКСИМ (evaluateScript)  — AI-оценка скрипта по 12 пунктам через GPT
 *   ИГОРЬ  (checkSLA)       — SLA без AI (просрочки, статус, контакт)
 */

// ОТВЕТСТВЕННЫЙ: МАКСИМ (Аудитор) — Тройная проверка качества, оценка звонков и сценариев.
import { supabase } from '@/utils/supabase';
import OpenAI from 'openai';
import { runInsightAnalysis } from './insight-agent';

let _openai: OpenAI | null = null;
function getOpenAI() {
    if (!_openai) _openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    return _openai;
}

// ═══════════════════════════════════════════════════════
// AI-ПОМОЩНИК СЕМЁНА: GPT-проверка наличия ТЗ в комментариях
// ═══════════════════════════════════════════════════════
async function checkTZWithAI(
    customerComment: string,
    managerComment: string,
    customFields: any
): Promise<{ tz_received: boolean; reason: string }> {
    // Быстрый путь: custom-поля имеют приоритет
    const tzFields = ['tz', 'technical_specification', 'width', 'height', 'depth', 'temperature'];
    if (tzFields.some(f => !!(customFields?.[f]))) {
        return { tz_received: true, reason: 'Техническое задание найдено в полях заказа RetailCRM.' };
    }

    const parts: string[] = [];
    if (customerComment?.trim()) parts.push(`Комментарий клиента: «${customerComment.trim()}»`);
    if (managerComment?.trim()) parts.push(`Комментарий оператора: «${managerComment.trim()}»`);

    if (parts.length === 0) {
        return { tz_received: false, reason: 'Комментарии клиента и оператора отсутствуют; ТЗ не найдено.' };
    }

    try {
        const openai = getOpenAI();
        const res = await openai.chat.completions.create({
            model: 'gpt-4o-mini',
            temperature: 0,
            response_format: { type: 'json_object' },
            messages: [
                {
                    role: 'system',
                    content: `Ты — ОКК-аналитик отдела продаж промышленного оборудования.
Определи, содержится ли в тексте достаточно информации для расчёта коммерческого предложения.
Признаки наличия ТЗ: размеры (мм, м, см), количество штук, температура, тип нагрева, нагрузка, материал, модель.
Верни JSON: {"tz_received": true/false, "reason": "одно предложение с цитатой из текста если нашёл"}`
                },
                {
                    role: 'user',
                    content: parts.join('\n\n').substring(0, 2000)
                }
            ]
        });

        const parsed = JSON.parse(res.choices[0].message.content || '{}');
        return {
            tz_received: !!parsed.tz_received,
            reason: parsed.reason ||
                (parsed.tz_received
                    ? 'ТЗ найдено в комментариях к заказу.'
                    : 'ТЗ не обнаружено ни в комментариях, ни в полях заказа.')
        };
    } catch (e) {
        console.error('[Семён/GPT checkTZ] Ошибка:', e);
        return { tz_received: false, reason: 'Ошибка AI-проверки ТЗ; проверьте вручную.' };
    }
}

function getManagerShortName(raw: any): string {
    const fullName = raw?.customFields?.change_name_manager || raw?.change_name_manager || raw?.manager?.firstName || 'Менеджер';
    // Берем только имя
    return fullName.split(' ')[0];
}

// ═══════════════════════════════════════════════════════
// СЕМЁН: Сбор фактов (без AI)
// Заполняет: Общая информация, Заполнение полей, Оценка разговоров
// ═══════════════════════════════════════════════════════
async function syncOrderFromRetailCRM(orderId: number) {
    const RETAILCRM_URL = process.env.RETAILCRM_URL || process.env.RETAILCRM_BASE_URL;
    const RETAILCRM_API_KEY = process.env.RETAILCRM_API_KEY;

    if (!RETAILCRM_URL || !RETAILCRM_API_KEY) return null;

    try {
        const baseUrl = RETAILCRM_URL.replace(/\/+$/, '');
        const url = `${baseUrl}/api/v5/orders/${orderId}?apiKey=${RETAILCRM_API_KEY}&by=id`;
        const res = await fetch(url);
        const data = await res.json();

        if (data.success && data.order) {
            const order = data.order;

            // Собираем телефоны как в основном синхронизаторе
            const phones = new Set<string>();
            const clean = (v: any) => String(v || '').replace(/[^\d+]/g, '');
            if (order.phone) phones.add(clean(order.phone));
            if (order.additionalPhone) phones.add(clean(order.additionalPhone));
            if (order.customer?.phones) order.customer.phones.forEach((p: any) => phones.add(clean(p.number)));
            if (order.contact?.phones) order.contact.phones.forEach((p: any) => phones.add(clean(p.number)));

            const mapped = {
                id: order.id,
                order_id: order.id,
                created_at: order.createdAt,
                updated_at: new Date().toISOString(),
                number: order.number || String(order.id),
                status: order.status,
                site: order.site || null,
                event_type: 'snapshot',
                manager_id: order.managerId ? String(order.managerId) : null,
                phone: clean(order.phone) || null,
                customer_phones: Array.from(phones),
                totalsumm: order.totalSumm || 0,
                raw_payload: order
            };

            // Используем RPC для надежного апдейта
            await supabase.rpc('upsert_orders_v2', {
                orders_data: [mapped]
            });

            return order;
        }
    } catch (e) {
        console.error(`[ОКК Sync] Ошибка синхронизации #${orderId}:`, e);
    }
    return null;
}

export async function collectFacts(orderId: number) {
    // Данные заказа
    const { data: order } = await supabase
        .from('orders')
        .select('raw_payload, created_at, status, updated_at, manager_id')
        .eq('order_id', orderId)
        .single();

    let raw = (order?.raw_payload as any) || {};

    // validate structure and normalize for easier downstream logic
    try {
        const { validateOrderPayload, normalizeOrderPayload } = await import('./payload-validator');
        validateOrderPayload(raw);
        const norm = normalizeOrderPayload(raw);
        // merge normalized properties back into raw for backwards compatibility
        raw = { ...raw, __normalized: norm };
    } catch (e) {
        // if validator module fails, we still continue with original raw
        console.warn('[ОКК] payload-validator failed:', e);
    }

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
            const startLimit = new Date(new Date(order.created_at).getTime() - 48 * 60 * 60 * 1000).toISOString();
            const endLimit = new Date(new Date(order.created_at).getTime() + 48 * 60 * 60 * 1000).toISOString();

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

    // N: ТЗ получено — AI-проверка по комментариям клиента, оператора и полям заказа
    const customerComment: string = raw?.customerComment || '';
    const managerComment: string = raw?.managerComment || '';
    const tzCheck = await checkTZWithAI(customerComment, managerComment, raw?.customFields);
    const tz_received = tzCheck.tz_received;

    // O: Покупатель заполнен
    const field_buyer_filled =
        raw.__normalized?.buyerExists !== undefined
            ? !!raw.__normalized.buyerExists
            : !!(
                raw?.company?.name ||
                raw?.contact?.name ||
                raw?.customer?.firstName ||
                raw?.customer?.lastName ||
                raw?.customer?.companyName ||
                raw?.customer?.nickName ||
                raw?.customer?.name ||
                (raw?.customer && typeof raw.customer === 'object' && !!raw.customer.type)
            );

    // P: Категория товара
    // Если мы уже нормализовали payload в начале collectFacts, берем результат оттуда.
    // Если нормализация упала (например, из-за zod), проверяем поля напрямую.
    const field_product_category = !!(
        raw.__normalized?.productCategory ||
        raw?.customFields?.typ_castomer ||
        raw?.customFields?.tovarnaya_kategoriya ||
        raw?.customFields?.product_category ||
        raw?.customFields?.category ||
        raw?.category
    );

    // debug output: if category not found but UI clearly has it, log raw payload snapshot
    if (!field_product_category) {
        console.debug('[ОКК] category flag false for order', orderId, 'normalized:', raw.__normalized?.productCategory, 'customFields:', raw.customFields);
    }

    // Q: Контактные данные
    const field_contact_data = !!(raw?.phone || raw?.email || raw?.contact?.phones?.length);

    // R: Релевантный номер найден — есть ли звонки вообще
    const relevant_number_found = outgoing.length > 0;

    // S: Ожидаемая сумма
    const field_expected_amount = !!(raw?.customFields?.expected_amount || raw?.customFields?.ozhidaemaya_summa || (raw?.totalSumm || 0) > 0);

    // T: Форма закупки
    // T: Форма закупки — реальные ключи: typ_customer_margin, vy_dlya_sebya_ili_dlya_zakazchika_priobretaete
    const field_purchase_form = !!(
        raw.__normalized?.purchaseForm ||
        raw?.customFields?.typ_customer_margin ||
        raw?.customFields?.vy_dlya_sebya_ili_dlya_zakazchika_priobretaete ||
        raw?.customFields?.purchase_form ||
        raw?.customFields?.forma_zakupki
    );

    // U: Сфера деятельности
    // U: Сфера деятельности — реальный ключ: sfera_deiatelnosti (через -ei-, не -ya-)
    const field_sphere_correct = !!(raw?.customFields?.sfera_deiatelnosti || raw?.customFields?.sphere_of_activity || raw?.customFields?.industry);

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
    const mName = getManagerShortName(raw);
    const reasons: Record<string, string> = {
        tz_received: tzCheck.reason,
        field_buyer_filled: field_buyer_filled
            ? `Семён: Поле 'Покупатель' заполнено; ${mName} заполнил(а) данные ${raw?.company?.name || raw?.contact?.name || raw?.customer?.firstName || 'клиента'}.`
            : "Семён: Поле 'Покупатель' не заполнено в RetailCRM.",
        field_product_category: field_product_category
            ? `Семён: Категория товара заполнена; ${mName} написал(а) — ${raw?.customFields?.typ_castomer || raw?.customFields?.tovarnaya_kategoriya || raw?.customFields?.product_category || 'категория указана'}.`
            : "Семён: Категория товара не заполнена в карточке заказа.",
        field_contact_data: field_contact_data
            ? `Семён: Контактные данные есть (${raw?.phone || raw?.email || 'телефон/email указаны'}).`
            : "Семён: В карточке клиента отсутствуют контактные данные.",
        relevant_number_found: relevant_number_found ? `Семён: Найдены звонки (${outgoing.length} исх.) по номеру клиента.` : "Семён: Исходящих звонков по номеру клиента не найдено.",
        field_expected_amount: field_expected_amount ? `Семён: Ожидаемая сумма указана; ${mName} оценил(а) сделку в ${raw?.totalSumm || raw?.customFields?.expected_amount || '0'} руб.` : "Семён: Сумма сделки (бюджет) не заполнена.",
        field_purchase_form: field_purchase_form ? `Семён: Форма закупки заполнена; ${mName} указал(а) — ${raw?.customFields?.typ_customer_margin || raw?.customFields?.vy_dlya_sebya_ili_dlya_zakazchika_priobretaete || 'заполнено'}.` : "Семён: Форма закупки не заполнена.",
        field_sphere_correct: field_sphere_correct ? `Семён: Сфера деятельности заполнена; ${mName} указал(а) — ${raw?.customFields?.sfera_deiatelnosti || raw?.customFields?.sphere_of_activity || 'указано'}.` : "Семён: Сфера деятельности клиента не указана.",
        mandatory_comments: mandatory_comments ? `Семён: ${mName} оставил(а) ${commentCount} комментариев к заказу.` : "Семён: Менеджер не оставил ни одного существенного комментария к заказу.",
        email_sent_no_answer: email_sent_no_answer ? (missedCalls.length > 0 ? `Семён: После неудачного звонка ${mName} отправил(а) письмо/сообщение.` : "Семён: Дозвон состоялся, отправка письма не требовалась.") : `Семён: Было пропущено ${missedCalls.length} вызовов, но ${mName} не отправил(а) письмо.`
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

    // H: дата первой попытки звонка ИЛИ другого касания (комментарий, статус)
    const sortedOutgoing = [...outgoing].sort((a: any, b: any) => new Date(a.started_at).getTime() - new Date(b.started_at).getTime());
    let first_contact_attempt_at = sortedOutgoing[0]?.started_at || null;

    // Если звонков нет, ищем первое действие менеджера в истории
    if (!first_contact_attempt_at) {
        const { data: firstTouch } = await supabase
            .from('order_history_log')
            .select('occurred_at, field')
            .eq('retailcrm_order_id', orderId)
            .in('field', ['status', 'manager_comment', 'custom_change_name_manager', 'email'])
            .order('occurred_at', { ascending: true })
            .limit(1);

        if (firstTouch?.[0]) {
            first_contact_attempt_at = firstTouch[0].occurred_at;
        }
    }

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
export async function checkSLA(orderId: number, order: any, leadReceivedAt: string | null, firstContactAt?: string | null) {
    const now = new Date();
    const updatedAt = new Date(order?.updated_at || Date.now());

    // J: Лид в работе менее суток с даты поступления
    // Правильная логика: сравниваем время первого контакта с датой поступления лида.
    // Если разница <= 24ч (или <=0 — контакт был ещё до создания заказа) — норма.
    const mName = getManagerShortName(order?.raw_payload);
    let lead_in_work_lt_1_day: boolean | null = null;
    let lead_in_work_reason = `Игорь: Данных о первом контакте ${mName} нет`;
    if (leadReceivedAt && firstContactAt) {
        const diffH = (new Date(firstContactAt).getTime() - new Date(leadReceivedAt).getTime()) / (1000 * 60 * 60);
        lead_in_work_lt_1_day = diffH <= 24; // включая отрицательные (контакт до заказа = ✅)
        const diffRounded = Math.round(Math.abs(diffH));
        if (diffH <= 0) {
            lead_in_work_reason = `Игорь: ${mName} связался(ась) ещё до создания заказа (опережение ${diffRounded}ч) — норма`;
        } else if (lead_in_work_lt_1_day) {
            lead_in_work_reason = `Игорь: ${mName} взял(а) лид в работу через ${diffRounded}ч — норма`;
        } else {
            lead_in_work_reason = `Игорь: Первый контакт ${mName} через ${diffRounded}ч — нарушение (норма до 24ч)`;
        }
    } else if (leadReceivedAt && !firstContactAt) {
        // Нет данных о звонках — не можем судить
        lead_in_work_lt_1_day = null;
        lead_in_work_reason = `Игорь: Звонков от ${mName} не найдено, оценить нельзя`;
    }

    // K: Дата следующего контакта не просрочена
    const nextContactRaw = (order?.raw_payload as any)?.customFields?.next_contact_date
        || (order?.raw_payload as any)?.customFields?.data_kontakta;
    let next_contact_not_overdue = true;
    let next_contact_reason = "Дата следующего контакта актуальна или не задана";

    if (nextContactRaw) {
        const d = new Date(nextContactRaw);
        next_contact_not_overdue = d >= now;
        const dateStr = d.toLocaleDateString('ru-RU');
        next_contact_reason = next_contact_not_overdue
            ? `Дата следующего контакта актуальна (${dateStr})`
            : `Дата следующего контакта просрочена (${dateStr})`;
    }

    // L: Лид в работе менее суток с даты получения ТЗ (если ТЗ есть — новый отсчёт)
    // Упрощение: берём updated_at как прокси
    const lead_in_work_lt_1_day_after_tz = lead_in_work_lt_1_day;
    const lead_in_work_after_tz_reason = lead_in_work_lt_1_day_after_tz !== null
        ? (lead_in_work_lt_1_day_after_tz ? `Игорь: Лид взят в работу вовремя после получения ТЗ` : `Игорь: Нарушение сроков после получения ТЗ`)
        : `Игорь: Нет данных для оценки скорости после ТЗ`;

    // M: Сделка в одном статусе менее 5 дней
    // Сначала пробуем найти дату последней смены статуса в истории
    const { data: statusHistory } = await supabase
        .from('order_history_log')
        .select('occurred_at')
        .eq('retailcrm_order_id', orderId)
        .eq('field', 'status')
        .order('occurred_at', { ascending: false })
        .limit(1);

    const statusChangedAtRaw = statusHistory?.[0]?.occurred_at;
    const statusChangedAt = statusChangedAtRaw
        ? new Date(statusChangedAtRaw)
        : new Date(order?.created_at || (order?.raw_payload as any)?.createdAt || Date.now());

    const diffMs = now.getTime() - statusChangedAt.getTime();
    const daysInStatus = diffMs / (1000 * 60 * 60 * 24);
    const deal_in_status_lt_5_days = daysInStatus < 5;

    return {
        lead_in_work_lt_1_day,
        next_contact_not_overdue,
        lead_in_work_lt_1_day_after_tz,
        deal_in_status_lt_5_days,
        _lead_in_work_reason: lead_in_work_reason,
        _next_contact_reason: next_contact_reason,
        _days_in_status: Math.round(daysInStatus),
    };
}

// ═══════════════════════════════════════════════════════
// МАКСИМ: AI-оценка скрипта (12 пунктов как в таблице)
// Заполняет: Установление контакта, Выявление потребностей,
//            Работа с возражениями, В конце диалога, Ведение диалога
// ═══════════════════════════════════════════════════════
export async function evaluateScript(transcript: string, annaInsights: any = null) {
    const empty = {
        script_greeting: { result: null, reason: null },
        script_call_purpose: { result: null, reason: null },
        script_company_info: { result: null, reason: null },
        script_lpr_identified: { result: null, reason: null },
        script_budget_confirmed: { result: null, reason: null },
        script_urgency_identified: { result: null, reason: null },
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

    console.log(`[Максим/GPT] Evaluation started. Transcript length: ${transcript?.length || 0}`);
    if (!transcript || transcript.length < 50) {
        console.warn('[Максим/GPT] Transcript too short or empty, skipping AI evaluation.');
        return empty as any;
    }

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
Тебе предоставлена ИСТОРИЯ ПЕРЕГОВОРОВ по одному заказу (все звонки в рамках сделки).
Твоя задача: оценить качество работы менеджера по чек-листу, используя сквозной анализ всей истории.

ОСНОВНЫЕ ПРАВИЛА:
1. ХОЛИСТИЧЕСКИЙ АНАЛИЗ: Если действие произошло в любом из звонков истории — оно считается выполненным (true).
2. ОБРАБОТКА N/A (НЕ ТРЕБОВАЛОСЬ): Если ситуация для критерия не возникла, ОБЯЗАТЕЛЬНО ставь "result": null и "reason": "Не требовалось". 
3. ИНТЕГРАЦИЯ С АННОЙ: Используй данные бизнес-аналитика Анны как "земную истину":
   - Если Анна нашла 'lpr' (имя или должность), значит менеджер выяснил ЛПР (true). Если Анна не нашла ЛПР и в диалоге нет попыток это выяснить — false.
   - Если Анна нашла 'budget' (сумму или готовность), значит бюджет затронут (true). Если в диалоге нет ни цифр, ни обсуждения денег — false.
   - Если Анна нашла 'urgency' или 'timeline', значит менеджер выяснил сроки (true).

ОТВЕТ ДОЛЖЕН БЫТЬ СТРОГО В ФОРМАТЕ JSON. 
Для каждого пункта верни объект: {"result": true/false/null, "reason": "ПОДРОБНОЕ обоснование с цитатой"}.

КРИТЕРИИ И СПЕЦИФИКА КЛАССИФИКАЦИИ:
- script_greeting: Приветствие и название компании.
- script_call_purpose: Озвучена причина звонка (привязка к заказу/этапу).
- script_company_info: Выявлена сфера деятельности клиента и чем занимается организация.
- script_lpr_identified: Выявлено Лицо, Принимающее Решение (кто еще участвует в выборе?).
- script_budget_confirmed: Обсужден финансовый вопрос или наличие бюджета.
- script_urgency_identified: Менеджер выяснил срочность покупки (нужно "вчера" или "к осени").
- script_deadlines: Выяснены конкретные сроки готовности или поставки (не путать со срочностью).
- script_tz_confirmed: Параметры тех. задания (размеры, температура) подтверждены.
- script_objection_general: Работа с возражениями. Если возражений не было — null. Если были и отработаны хоть раз в истории — true.
- script_objection_delays: Если клиент тянет сроки или Анна видит конкурентов — выяснил ли менеджер "с кем сравнивают?". Если Анна видит конкурентов, а вопроса не было — false. Если сравнения нет — null.
- script_offer_best_tech: Аргументация через ТЕХНИЧЕСКИЕ преимущества (мощность, ресурс, ГОСТ), особенно по болям от Анны. Если тех. требований не было — null.
- script_offer_best_terms: Аргументы по СРОКАМ (наличие, ускорение), особенно если 'urgency: hot'. Если сроки не критичны — null.
- script_offer_best_price: Обоснование ЦЕНЫ (ценность, сервис, условия оплаты). Если клиент не торговался — null.
- script_cross_sell: Предложение сопутствующих товаров (печи -> расходники).
- script_next_step_agreed: Фиксация следующего шага с ДАТОЙ.
- script_dialogue_management: Менеджер держал инициативу и вел по структуре.
- script_confident_speech: Уверенность, грамотность, отсутствие слов-паразитов.

ПЕРСОНАЛИЗАЦИЯ:
В "reason" всегда упоминай менеджера по имени (из контекста).

РАСЧЕТ script_score_pct:
- Рассчитывай % только по тем пунктам, где result НЕ null. 
- (Кол-во true / Кол-во (true + false)) * 100.
- Если все пункты null, верни 100.

Также верни:
- script_score_pct: число (0-100).
- evaluator_comment: аналитическое резюме по всей сделке.`
                },
                {
                    role: 'user',
                    content: `БИЗНЕС-АНАЛИТИКА ОТ АННЫ (контекст сделки):
${annaInsights ? JSON.stringify(annaInsights, null, 2) : 'Данные аналитики по сделке отсутствуют.'}

ИСТОРИЯ ЗВОНКОВ:
${transcript.substring(0, 15000)}`
                }
            ]
        });

        const rawContent = res.choices[0].message.content || '{}';
        console.log('[Максим/GPT] Raw AI response received:', rawContent);
        const parsed = JSON.parse(rawContent);
        const getVal = (key: string) => ({
            result: parsed[key]?.result ?? null,
            reason: parsed[key]?.reason ?? null
        });

        return {
            script_greeting: getVal('script_greeting'),
            script_call_purpose: getVal('script_call_purpose'),
            script_company_info: getVal('script_company_info'),
            script_lpr_identified: getVal('script_lpr_identified'),
            script_budget_confirmed: getVal('script_budget_confirmed'),
            script_urgency_identified: getVal('script_urgency_identified'),
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
            script_score_pct: typeof parsed.script_score_pct === 'number' ? Math.round(Math.min(100, Math.max(0, parsed.script_score_pct))) : null,
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
        score_breakdown[k] = { result: data[k] === true, reason: data._reasons[k] };
    });

    // Часть SLA (Игорь)
    score_breakdown.lead_in_work_lt_1_day = { result: data.lead_in_work_lt_1_day, reason: data.lead_in_work_reason };
    score_breakdown.next_contact_not_overdue = { result: data.next_contact_not_overdue, reason: data.next_contact_reason };
    score_breakdown.lead_in_work_lt_1_day_after_tz = { result: data.lead_in_work_lt_1_day_after_tz, reason: data.lead_in_work_after_tz_reason };
    score_breakdown.deal_in_status_lt_5_days = { result: data.deal_in_status_lt_5_days, reason: data.deal_in_status_reason };

    // Скрипт (Максим)
    const scriptKeys = [
        'script_greeting', 'script_call_purpose', 'script_company_info',
        'script_lpr_identified', 'script_budget_confirmed', 'script_urgency_identified',
        'script_deadlines', 'script_tz_confirmed', 'script_objection_general',
        'script_objection_delays', 'script_offer_best_tech', 'script_offer_best_terms',
        'script_offer_best_price', 'script_cross_sell', 'script_next_step_agreed',
        'script_dialogue_management', 'script_confident_speech'
    ];
    scriptKeys.forEach(k => {
        if (data[k] && typeof data[k] === 'object') {
            score_breakdown[k] = data[k];
        }
    });

    return { deal_score, deal_score_pct, script_score, total_score, score_breakdown };
}

// ═══════════════════════════════════════════════════════
// ГЛАВНЫЙ МЕТОД: оценить один заказ
// ═══════════════════════════════════════════════════════
export async function evaluateOrder(orderId: number): Promise<void> {
    console.log(`[ОКК] Оцениваем заказ #${orderId}`);

    // [LIVE SYNC] Перед оценкой обновляем данные из RetailCRM
    await syncOrderFromRetailCRM(orderId);

    // Семён собирает факты
    const facts = await collectFacts(orderId);

    // Игорь проверяет SLA (получает firstContactAt от Семёна)
    const sla = await checkSLA(orderId, facts._order, facts.lead_received_at, facts.first_contact_attempt_at);

    // [СИНЕРГИЯ] Анна готовит глубокую аналитику для Максима
    const annaInsights = await runInsightAnalysis(orderId);

    // Максим оценивает скрипт (используя данные от Анны)
    const script = await evaluateScript(facts._transcript, annaInsights);

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
export async function runFullEvaluation(params?: {
    limit?: number;
    specificOrderId?: number;
    onlyMissing?: boolean;
}): Promise<{ processed: number; errors: number }> {
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

        // 1. Получаем ID всех активных заказов
        let query = supabase
            .from('orders')
            .select('order_id')
            .in('status', statusCodes)
            .lt('order_id', 99900000)
            .order('created_at', { ascending: false });

        if (params?.limit) {
            query = query.limit(params.limit);
        }

        const { data: orders } = await query;
        let candidates = orders || [];

        // 2. Если нужно только пропущено, фильтруем по отсутствию оценки скрипта
        if (params?.onlyMissing && candidates.length > 0) {
            const ids = candidates.map(c => c.order_id);
            const { data: existingScores } = await supabase
                .from('okk_order_scores')
                .select('order_id')
                .in('order_id', ids)
                .not('script_score_pct', 'is', null);

            const hasScore = new Set((existingScores || []).map(s => s.order_id));
            candidates = candidates.filter(c => !hasScore.has(c.order_id));
            console.log(`[ОКК] Найдено ${candidates.length} заказов без оценки скрипта из ${ids.length} кандидатов.`);
        }

        ordersToProcess = candidates;
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
