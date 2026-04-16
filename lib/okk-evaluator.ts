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
import { OKK_CONSULTANT_GUIDES } from './okk-consultant';

let _openai: OpenAI | null = null;
const GUIDE_MAP = new Map(OKK_CONSULTANT_GUIDES.map((guide) => [guide.key, guide]));

const DEFAULT_SOURCE_REFS: Record<string, string[]> = {
    tz_received: ['orders.raw_payload.customerComment', 'orders.raw_payload.managerComment', 'orders.raw_payload.customFields'],
    field_buyer_filled: ['orders.raw_payload.company', 'orders.raw_payload.contact', 'orders.raw_payload.customer'],
    field_product_category: ['orders.raw_payload.customFields', 'orders.raw_payload.category'],
    field_contact_data: ['orders.raw_payload.phone', 'orders.raw_payload.email', 'orders.raw_payload.contact.phones'],
    relevant_number_found: ['call_order_matches', 'raw_telphin_calls.from_number', 'raw_telphin_calls.to_number'],
    field_expected_amount: ['orders.raw_payload.customFields.expected_amount', 'orders.raw_payload.totalSumm'],
    field_purchase_form: ['orders.raw_payload.customFields.typ_customer_margin', 'orders.raw_payload.customFields.vy_dlya_sebya_ili_dlya_zakazchika_priobretaete'],
    field_sphere_correct: ['orders.raw_payload.customFields.sfera_deiatelnosti'],
    mandatory_comments: ['raw_order_events.event_type'],
    email_sent_no_answer: ['raw_order_events.event_type', 'raw_telphin_calls.direction', 'raw_telphin_calls.transcript'],
    lead_in_work_lt_1_day: ['orders.created_at', 'raw_telphin_calls.started_at', 'order_history_log.occurred_at'],
    next_contact_not_overdue: ['orders.raw_payload.customFields.next_contact_date', 'orders.raw_payload.customFields.data_kontakta'],
    lead_in_work_lt_1_day_after_tz: ['orders.updated_at', 'orders.raw_payload.customFields'],
    deal_in_status_lt_5_days: ['order_history_log.occurred_at', 'orders.created_at'],
};

function getOpenAI() {
    if (!_openai) _openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    return _openai;
}

function inferConfidence(result: boolean | null | undefined, reason: string | null | undefined) {
    if (result === null || result === undefined) return 0.35;
    const lower = String(reason || '').toLowerCase();
    if (lower.includes('ошибка ai')) return 0.4;
    if (lower.includes('оценить нельзя') || lower.includes('нет данных')) return 0.45;
    return 0.82;
}

function pickRawPayload(data: Record<string, any>) {
    return data?._order?.raw_payload || {};
}

function getSourceValues(key: string, data: Record<string, any>) {
    const raw = pickRawPayload(data);
    switch (key) {
        case 'tz_received':
            if (data._tz_evidence) {
                return {
                    customer_comment: data._tz_evidence.customer_comment || null,
                    manager_comment: data._tz_evidence.manager_comment || null,
                    tz_field_keys: data._tz_evidence.tz_field_keys || [],
                    tz_detected: data.tz_received ?? null,
                };
            }
            return {
                customer_comment_present: Boolean(raw?.customerComment),
                manager_comment_present: Boolean(raw?.managerComment),
                custom_fields_present: Boolean(raw?.customFields),
            };
        case 'field_buyer_filled':
            return {
                company_name: raw?.company?.name || null,
                contact_name: raw?.contact?.name || null,
                customer_name: raw?.customer?.firstName || raw?.customer?.name || null,
            };
        case 'field_product_category':
            return {
                product_category: raw?.customFields?.typ_castomer || raw?.customFields?.tovarnaya_kategoriya || raw?.customFields?.product_category || raw?.category || null,
            };
        case 'field_contact_data':
            return {
                phone: raw?.phone || null,
                email: raw?.email || null,
                extra_phones: raw?.contact?.phones?.length || 0,
            };
        case 'relevant_number_found':
            if (Array.isArray(data._call_evidence)) {
                return {
                    calls_attempts_count: data.calls_attempts_count || 0,
                    calls_evaluated_count: data.calls_evaluated_count || 0,
                    calls_status: data.calls_status || null,
                    calls: data._call_evidence,
                };
            }
            return {
                calls_attempts_count: data.calls_attempts_count || 0,
                calls_evaluated_count: data.calls_evaluated_count || 0,
                calls_status: data.calls_status || null,
            };
        case 'field_expected_amount':
            return {
                total_sum: raw?.totalSumm || null,
                expected_amount: raw?.customFields?.expected_amount || raw?.customFields?.ozhidaemaya_summa || null,
            };
        case 'field_purchase_form':
            return {
                purchase_form: raw?.customFields?.typ_customer_margin || raw?.customFields?.vy_dlya_sebya_ili_dlya_zakazchika_priobretaete || null,
            };
        case 'field_sphere_correct':
            return {
                sphere: raw?.customFields?.sfera_deiatelnosti || raw?.customFields?.sphere_of_activity || null,
            };
        case 'mandatory_comments':
            return {
                comment_reason: data._reasons?.mandatory_comments || null,
            };
        case 'email_sent_no_answer':
            if (Array.isArray(data._call_evidence)) {
                return {
                    calls_status: data.calls_status || null,
                    calls_attempts_count: data.calls_attempts_count || 0,
                    calls: data._call_evidence,
                };
            }
            return {
                calls_status: data.calls_status || null,
                calls_attempts_count: data.calls_attempts_count || 0,
            };
        case 'lead_in_work_lt_1_day':
            return {
                lead_received_at: data.lead_received_at || null,
                first_contact_attempt_at: data.first_contact_attempt_at || null,
                time_to_first_contact: data.time_to_first_contact || null,
            };
        case 'next_contact_not_overdue':
            return {
                next_contact_date: raw?.customFields?.next_contact_date || raw?.customFields?.data_kontakta || null,
            };
        case 'lead_in_work_lt_1_day_after_tz':
            return {
                lead_in_work_lt_1_day: data.lead_in_work_lt_1_day ?? null,
                tz_received: data.tz_received ?? null,
            };
        case 'deal_in_status_lt_5_days':
            return {
                order_status: data.order_status || null,
                order_updated_at: data._order?.updated_at || null,
            };
        default:
            return null;
    }
}

function getMissingData(key: string, data: Record<string, any>, reason: string | null | undefined) {
    const raw = pickRawPayload(data);
    const missing: string[] = [];
    if (String(reason || '').toLowerCase().includes('нет данных')) missing.push('system:no-data');
    switch (key) {
        case 'tz_received':
            if (!raw?.customerComment && !raw?.managerComment && !raw?.customFields) missing.push('order:comments_or_custom_fields');
            break;
        case 'field_contact_data':
            if (!raw?.phone && !raw?.email && !raw?.contact?.phones?.length) missing.push('order:contact_data');
            break;
        case 'relevant_number_found':
            if (!data.calls_attempts_count) missing.push('calls:matched_outgoing');
            break;
        case 'lead_in_work_lt_1_day':
            if (!data.lead_received_at) missing.push('order:lead_received_at');
            if (!data.first_contact_attempt_at) missing.push('order:first_contact_attempt_at');
            break;
        case 'next_contact_not_overdue':
            if (!raw?.customFields?.next_contact_date && !raw?.customFields?.data_kontakta) missing.push('order:next_contact_date');
            break;
        default:
            break;
    }
    return missing;
}

function createBreakdownEntry(
    key: string,
    result: boolean | null | undefined,
    reason: string | null | undefined,
    data: Record<string, any>,
    extras: Record<string, any> = {},
) {
    const guide = GUIDE_MAP.get(key);
    const missingData = extras.missing_data || getMissingData(key, data, reason);
    return {
        result: result ?? null,
        reason: reason ?? null,
        reason_human: reason ?? null,
        rule_id: extras.rule_id || key,
        owner: extras.owner || guide?.owner || null,
        group: extras.group || guide?.group || null,
        source_refs: extras.source_refs || guide?.dataSources || DEFAULT_SOURCE_REFS[key] || [],
        source_values: extras.source_values !== undefined ? extras.source_values : getSourceValues(key, data),
        calculation_steps: extras.calculation_steps || [],
        confidence: extras.confidence ?? inferConfidence(result, reason),
        missing_data: missingData,
        recommended_fix: extras.recommended_fix || guide?.howToFix || null,
        ambiguous_explanation: extras.ambiguous_explanation ?? ((result === null || result === undefined) || missingData.length > 0),
        context_fragment: extras.context_fragment || null,
        model: extras.model || null,
        evidence_type: extras.evidence_type || 'rule',
        penalty_impact: extras.penalty_impact ?? 0,
        penalty_journal: extras.penalty_journal,
    };
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

// ═══════════════════════════════════════════════════════
// AI-ПОМОЩНИК СЕМЁНА: GPT-проверка состоялся ли реальный разговор
// ═══════════════════════════════════════════════════════
async function detectRealConversation(
    transcript: string
): Promise<{ is_human: boolean; reason: string }> {
    if (!transcript || transcript.trim().length < 20) {
        return { is_human: false, reason: 'Текст слишком короткий или отсутствует.' };
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
                    content: `Ты — ассистент ОКК (Семён). Определи по расшифровке телефонного звонка:
Это реальный разговор с живым человеком (клиентом) или звонок попал на автоответчик / голосовое меню (IVR) / фоновую музыку / тишину?
Учти, что автоответчики могут долго говорить (Например: "Ваш звонок очень важен для нас..."). Если человек поговорил с живым оператором на стороне клиента (например, секретарь) - это тоже живой человек.
Верни JSON: {"is_human": true/false, "reason": "Краткое обоснование, почему ты так решил"}`
                },
                {
                    role: 'user',
                    content: `Транскрипция звонка:\n${transcript.substring(0, 1500)}`
                }
            ]
        });

        const parsed = JSON.parse(res.choices[0].message.content || '{}');
        return {
            is_human: !!parsed.is_human,
            reason: parsed.reason || (parsed.is_human ? 'Похоже на диалог с человеком' : 'Похоже на автоответчик')
        };
    } catch (e) {
        console.error('[Семён/GPT detectRealConversation] Ошибка:', e);
        // Fallback: if AI fails, assume it's human if it's long enough, just to be safe it's not strictly failed
        return { is_human: transcript.length > 50, reason: 'Ошибка AI, резервная оценка по длине текста.' };
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
export async function syncOrderFromRetailCRM(orderId: number) {
    const { fetchRetailCrmOrder, upsertRetailCrmOrders } = await import('./retailcrm-orders');

    try {
        const order = await fetchRetailCrmOrder(orderId);

        if (order) {
            await upsertRetailCrmOrders([order]);
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

    calls = (callMatches || []).map((m: any) => ({
        ...(m.raw_telphin_calls || {}),
        telphin_call_id: m.telphin_call_id || null,
        matched_by: 'call_order_matches',
    })).filter(Boolean);

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
                calls = fallbackCalls.map((call: any) => ({
                    ...call,
                    telphin_call_id: null,
                    matched_by: 'phone_fallback',
                }));
            }
        }
    }

    const outgoing = calls.filter((c: any) => c.direction === 'outgoing');

    // Определяем "реальные" разговоры (Семён + ИИ)
    // Сохраняем результат классификации, чтобы использовать в обосновании
    const callAnalysisResults: Record<string, { is_human: boolean; reason: string }> = {};

    // Сначала фильтруем звонки > 15 секунд, так как короткие очевидно недозвон
    const potentialConnectedCalls = calls.filter((c: any) => (c.duration_sec || 0) > 15);
    const connectedCalls: any[] = [];

    for (const call of potentialConnectedCalls) {
        if (!call.transcript) {
            // Если транскрипции нет, но разговор долгий (>15с), считаем дозвоном по старой логике (на всякий случай)
            callAnalysisResults[call.recording_url || call.started_at] = {
                is_human: true,
                reason: 'Нет транскрипции, но длительность больше 15 секунд; применён fallback как к живому разговору.',
            };
            connectedCalls.push(call);
            continue;
        }

        const analysis = await detectRealConversation(call.transcript);
        callAnalysisResults[call.recording_url || call.started_at] = analysis;

        if (analysis.is_human) {
            connectedCalls.push(call);
        }
    }

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
    const tzFieldKeys = ['tz', 'technical_specification', 'width', 'height', 'depth', 'temperature']
        .filter((field) => Boolean(raw?.customFields?.[field]));

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
    // Недозвоны - это все исходящие, которые НЕ попали в список connectedCalls
    // Мы можем найти их просто вычитая.
    const connectedRecordingUrls = new Set(connectedCalls.map(c => c.recording_url || c.started_at));
    const missedCalls = outgoing.filter((c: any) => !connectedRecordingUrls.has(c.recording_url || c.started_at));
    const hasConnectedCalls = connectedCalls.length > 0;

    let email_sent_no_answer = false;
    let email_reason = "";

    if (hasConnectedCalls) {
        // Успешный разговор состоялся
        email_sent_no_answer = true;
        email_reason = "Семён: Дозвон состоялся (подтверждено ИИ), отправка письма не требовалась.";
    } else {
        // Звонков не было вообще, либо все попали на автоответчик/недозвон.
        const { count: emailCount } = await supabase
            .from('raw_order_events')
            .select('event_id', { count: 'exact', head: true })
            .eq('retailcrm_order_id', orderId)
            .ilike('event_type', '%email%');

        const hasEmails = (emailCount || 0) > 0;
        email_sent_no_answer = hasEmails;

        if (missedCalls.length > 0) {
            // Был недозвон (или автоответчик распознанный ИИ)
            // Пытаемся найти причину, если это был автоответчик
            const aiReasons = missedCalls
                .map(c => callAnalysisResults[c.recording_url || c.started_at])
                .filter(Boolean)
                .map(r => r.reason);

            const aiNote = aiReasons.length > 0 ? ` (Срабатывал автоответчик)` : '';

            email_reason = hasEmails
                ? `Семён: После неудачного звонка${aiNote} менеджер отправил(а) письмо/сообщение.`
                : `Семён: Было пропущено ${missedCalls.length} вызовов${aiNote}, но менеджер не отправил(а) письмо.`;
        } else {
            // Менеджер вообще не пытался звонить
            email_reason = hasEmails
                ? `Семён: Звонков не было, но менеджер ведет переписку по email.`
                : `Семён: Звонки не совершались, письма клиенту не отправлялись.`;
        }
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
        email_sent_no_answer: email_reason
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

    const callEvidence = calls
        .sort((a: any, b: any) => new Date(a.started_at || 0).getTime() - new Date(b.started_at || 0).getTime())
        .map((call: any) => {
            const analysis = callAnalysisResults[call.recording_url || call.started_at];
            const included = connectedCalls.some((connected: any) => (connected.recording_url || connected.started_at) === (call.recording_url || call.started_at));
            return {
                telphin_call_id: call.telphin_call_id || null,
                started_at: call.started_at || null,
                direction: call.direction || null,
                duration_sec: call.duration_sec || 0,
                matched_by: call.matched_by || 'unknown',
                has_transcript: Boolean(call.transcript),
                transcript_excerpt: call.transcript ? String(call.transcript).slice(0, 220) : null,
                included_in_score: included,
                classification: analysis ? (analysis.is_human ? 'human' : 'auto') : null,
                classification_reason: analysis?.reason || null,
            };
        });

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
        _reasons: reasons,
        _call_evidence: callEvidence,
        _tz_evidence: {
            customer_comment: customerComment || null,
            manager_comment: managerComment || null,
            tz_field_keys: tzFieldKeys,
        },
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

    const deal_in_status_reason = deal_in_status_lt_5_days
        ? `Игорь: Сделка в статусе ${Math.round(daysInStatus)} дн. (норма до 5)`
        : `Игорь: Сделка зависла в статусе на ${Math.round(daysInStatus)} дн.`;

    return {
        lead_in_work_lt_1_day,
        lead_in_work_reason,
        next_contact_not_overdue,
        next_contact_reason,
        lead_in_work_lt_1_day_after_tz,
        lead_in_work_after_tz_reason,
        deal_in_status_lt_5_days,
        deal_in_status_reason
    };
}

// ═══════════════════════════════════════════════════════
// МАКСИМ: AI-оценка скрипта (12 пунктов как в таблице)
// Заполняет: Установление контакта, Выявление потребностей,
//            Работа с возражениями, В конце диалога, Ведение диалога
// ═══════════════════════════════════════════════════════
export async function evaluateScript(transcript: string, annaInsights: any = null) {
    const empty = {
        script_greeting: { result: false, reason: "Нет данных для анализа (нет звонков/транскрипции)" },
        script_call_purpose: { result: false, reason: "Нет данных для анализа" },
        script_company_info: { result: false, reason: "Нет данных для анализа" },
        script_lpr_identified: { result: false, reason: "Нет данных для анализа" },
        script_budget_confirmed: { result: false, reason: "Нет данных для анализа" },
        script_urgency_identified: { result: false, reason: "Нет данных для анализа" },
        script_deadlines: { result: false, reason: "Нет данных для анализа" },
        script_tz_confirmed: { result: false, reason: "Нет данных для анализа" },
        script_objection_general: { result: false, reason: "Нет данных для анализа (возражения не отработаны)" },
        script_objection_delays: { result: false, reason: "Нет данных для анализа" },
        script_offer_best_tech: { result: false, reason: "Нет данных для анализа" },
        script_offer_best_terms: { result: false, reason: "Нет данных для анализа" },
        script_offer_best_price: { result: false, reason: "Нет данных для анализа" },
        script_cross_sell: { result: false, reason: "Нет данных для анализа" },
        script_next_step_agreed: { result: false, reason: "Нет данных для анализа" },
        script_dialogue_management: { result: false, reason: "Нет данных для анализа" },
        script_confident_speech: { result: false, reason: "Нет данных для анализа" },
        script_score_pct: 0,
        evaluator_comment: "Звонки не найдены или слишком короткие для анализа. Оценка 0.",
        _meta: {
            model: null,
            transcript_length: transcript?.length || 0,
            transcript_excerpt: transcript?.slice(0, 280) || null,
            anna_insights_available: Boolean(annaInsights),
        }
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
2. СТРОГАЯ ОЦЕНКА (БЕЗ N/A): Вариант "null" (Не требовалось) ЗАПРЕЩЕН. Все критерии должны быть оценены как true (выполнено) или false (не выполнено).
   - Если информации нет, ситуация не возникла или менеджер промолчал — ставь false.
   - Пример: Если клиент не возражал, а пункт "Работа с возражениями" требует оценки — ставь false (так как навык не проявлен/не проверен), либо true, только если менеджер предвосхитил возражения. В данном случае, СЧИТАЙ ОТСУТСТВИЕ РАБОТЫ С ВОЗРАЖЕНИЯМИ КАК false.
   - Любое сомнение трактуй как false (в пользу строгости).

3. ИНТЕГРАЦИЯ С АННОЙ: Используй данные бизнес-аналитика Анны как "земную истину":
   - Если Анна нашла 'lpr' (имя или должность), значит менеджер выяснил ЛПР (true). Если Анна не нашла ЛПР и в диалоге нет попыток это выяснить — false.
   - Если Анна нашла 'budget' (сумму или готовность), значит бюджет затронут (true). Если в диалоге нет ни цифр, ни обсуждения денег — false.
   - Если Анна нашла 'urgency' или 'timeline', значит менеджер выяснил сроки (true).

ОТВЕТ ДОЛЖЕН БЫТЬ СТРОГО В ФОРМАТЕ JSON. 
Для каждого пункта верни объект: {"result": true/false, "reason": "ПОДРОБНОЕ обоснование с цитатой"}.

КРИТЕРИИ И СПЕЦИФИКА КЛАССИФИКАЦИИ:
- script_greeting: Приветствие и название компании. (Есть - true, Нет - false)
- script_call_purpose: Озвучена причина звонка (привязка к заказу/этапу). (Есть - true, Нет - false)
- script_company_info: Выявлена сфера деятельности клиента и чем занимается организация. (Есть - true, Нет - false)
- script_lpr_identified: Выявлено Лицо, Принимающее Решение (кто еще участвует в выборе?). (Есть - true, Нет - false)
- script_budget_confirmed: Обсужден финансовый вопрос или наличие бюджета. (Есть - true, Нет - false)
- script_urgency_identified: Менеджер выяснил срочность покупки (нужно "вчера" или "к осени"). (Есть - true, Нет - false)
- script_deadlines: Выяснены конкретные сроки готовности или поставки (не путать со срочностью). (Есть - true, Нет - false)
- script_tz_confirmed: Параметры тех. задания (размеры, температура) подтверждены. (Есть - true, Нет - false)
- script_objection_general: Работа с возражениями. Если были возражения и отработаны — true. Если возражений НЕ было или они не отработаны — false.
- script_objection_delays: Выяснение причин задержек/сравнения. Если клиент тянет время — выяснил ли менеджер причину? (Да - true, Нет/Не спросил - false).
- script_offer_best_tech: Аргументация через ТЕХНИЧЕСКИЕ преимущества. (Была - true, Нет - false).
- script_offer_best_terms: Аргументы по СРОКАМ. (Были - true, Нет - false).
- script_offer_best_price: Обоснование ЦЕНЫ. (Было - true, Нет - false).
- script_cross_sell: Предложение сопутствующих товаров. (Было - true, Нет - false).
- script_next_step_agreed: Фиксация следующего шага с ДАТОЙ. (Есть дата след. касания - true, Нет - false).
- script_dialogue_management: Менеджер держал инициативу. (Да - true, Нет/Плыл по течению - false).
- script_confident_speech: Уверенная речь. (Да - true, Нет - false).

ПЕРСОНАЛИЗАЦИЯ:
В "reason" всегда упоминай менеджера по имени (из контекста).

РАСЧЕТ script_score_pct:
- Рассчитывай % как (Кол-во true / Общее кол-во пунктов) * 100.
- Все пункты должны быть либо true, либо false. 
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
            _meta: {
                model: 'gpt-4o-mini',
                transcript_length: transcript.length,
                transcript_excerpt: transcript.substring(0, 280),
                anna_insights_available: Boolean(annaInsights),
            }
        };

    } catch (e) {
        console.error('[Максим/GPT] Script evaluation failed:', e);
        return empty as any;
    }
}

// ═══════════════════════════════════════════════════════
// Расчёт итогового % (X, Y, AR, AS)
// ═══════════════════════════════════════════════════════
function calcScores(data: Record<string, any>, totalPenalty: number = 0, penaltyJournal: any[] = []) {
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
    let deal_score_pct = dealChecks.length > 0 ? Math.round((dealPassed / dealChecks.length) * 100) : null;

    // Скрипт (Максим возвращает {result, reason})
    let script_score_pct = data.script_score_pct ?? null;
    const script_score = script_score_pct !== null ? Math.round((script_score_pct / 100) * 14) : null;

    // Общий %
    let total_score: number | null = null;
    if (deal_score_pct !== null && script_score_pct !== null) {
        total_score = Math.round((deal_score_pct + script_score_pct) / 2);
    } else if (deal_score_pct !== null) total_score = deal_score_pct;
    else if (script_score_pct !== null) total_score = script_score_pct;

    const total_score_before_penalty = total_score;

    // Вычитаем штрафные баллы
    if (total_score !== null && totalPenalty > 0) {
        total_score = Math.max(0, total_score - totalPenalty);
        // Также уменьшаем deal_score_pct пропорционально, чтобы отразить нарушения на графиках если нужно
        if (deal_score_pct !== null) {
            deal_score_pct = Math.max(0, deal_score_pct - totalPenalty);
        }
    }

    // Сборка breakdown для UI
    const score_breakdown: Record<string, any> = {};

    // Техническая часть (Семён)
    Object.keys(data._reasons || {}).forEach(k => {
        const rawResult = data[k];
        score_breakdown[k] = createBreakdownEntry(
            k,
            rawResult === true ? true : rawResult === false ? false : null,
            data._reasons[k],
            data,
            {
                calculation_steps: [`Проверен критерий ${k} по данным RetailCRM/событиям и сохранён итоговый признак ${rawResult ?? 'null'}.`],
            },
        );
    });

    // Часть SLA (Игорь)
    score_breakdown.lead_in_work_lt_1_day = createBreakdownEntry('lead_in_work_lt_1_day', data.lead_in_work_lt_1_day, data.lead_in_work_reason, data, {
        calculation_steps: [
            `Берём lead_received_at=${data.lead_received_at || 'null'} и first_contact_attempt_at=${data.first_contact_attempt_at || 'null'}.`,
            'Если разница <= 24 часов, критерий считается выполненным.',
        ],
    });
    score_breakdown.next_contact_not_overdue = createBreakdownEntry('next_contact_not_overdue', data.next_contact_not_overdue, data.next_contact_reason, data, {
        calculation_steps: ['Смотрим дату следующего контакта в customFields.', 'Сравниваем с текущей датой: просрочка даёт false.'],
    });
    score_breakdown.lead_in_work_lt_1_day_after_tz = createBreakdownEntry('lead_in_work_lt_1_day_after_tz', data.lead_in_work_lt_1_day_after_tz, data.lead_in_work_after_tz_reason, data, {
        calculation_steps: ['Используется SLA-проверка после получения ТЗ.', 'Если нет достаточных данных, результат может быть null.'],
    });
    score_breakdown.deal_in_status_lt_5_days = createBreakdownEntry('deal_in_status_lt_5_days', data.deal_in_status_lt_5_days, data.deal_in_status_reason, data, {
        calculation_steps: ['Ищем дату последней смены статуса.', 'Если с последней смены прошло меньше 5 дней, критерий выполнен.'],
    });

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
            score_breakdown[k] = createBreakdownEntry(k, data[k].result ?? null, data[k].reason ?? null, data, {
                source_refs: Array.from(new Set([...(GUIDE_MAP.get(k)?.dataSources || []), 'raw_telphin_calls.transcript', 'anna_insights'])),
                source_values: {
                    transcript_length: data._script_meta?.transcript_length || 0,
                    anna_insights_available: Boolean(data._script_meta?.anna_insights_available),
                },
                calculation_steps: ['AI анализирует всю историю транскрипций по сделке.', 'Для каждого пункта возвращается true/false и текстовое обоснование.'],
                confidence: data[k].result === null || data[k].result === undefined ? 0.35 : 0.72,
                context_fragment: data._script_meta?.transcript_excerpt || null,
                model: data._script_meta?.model || null,
                evidence_type: 'ai',
                ambiguous_explanation: !data._script_meta?.transcript_length,
            });
        }
    });

    score_breakdown._meta = createBreakdownEntry('_meta', null, 'Служебная сводка explainability для итогового расчёта.', data, {
        rule_id: 'score_summary',
        owner: 'Максим',
        group: 'System',
        source_refs: ['okk_order_scores.score_breakdown', 'okk_violations', 'orders', 'raw_telphin_calls'],
        source_values: {
            deal_checks_total: dealChecks.length,
            deal_checks_passed: dealPassed,
            deal_score_pct,
            script_score_pct,
            total_score_before_penalty,
            total_score_after_penalty: total_score,
            total_penalty: totalPenalty,
        },
        calculation_steps: [
            `deal_score_pct = round(${dealPassed}/${dealChecks.length || 1} * 100) => ${deal_score_pct ?? 'null'}`,
            `script_score = round(script_score_pct / 100 * 14) => ${script_score ?? 'null'}`,
            total_score_before_penalty !== null
                ? `total_score = среднее итоговых процентов => ${total_score_before_penalty}`
                : 'total_score не рассчитан из-за отсутствия базовых процентов.',
            totalPenalty > 0
                ? `После штрафов итог уменьшен на ${totalPenalty} п. => ${total_score}`
                : 'Штрафы не применялись.',
        ],
        confidence: 1,
        missing_data: [],
        recommended_fix: null,
        ambiguous_explanation: false,
        evidence_type: 'system',
        penalty_impact: totalPenalty,
        penalty_journal: penaltyJournal.map((item) => ({
            rule_code: item.rule_code || null,
            severity: item.severity || null,
            points: item.points || 0,
            details: item.details || 'Нарушение правила',
            detected_at: item.detected_at || item.violation_time || null,
        })),
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

    // Получаем список нарушений из Rule Engine, чтобы вычесть штрафные баллы
    const { data: orderViolations } = await supabase
        .from('okk_violations')
        .select('rule_code, severity, details, points, detected_at, violation_time')
        .eq('order_id', orderId);

    const typedViolations = (orderViolations || []) as Array<{ points?: number | null }>;
    const totalPenalty = typedViolations.reduce((sum, violation) => sum + (violation.points || 0), 0);

    // Максим считает итог
    const allData = { ...facts, ...sla, ...script };
    const scores = calcScores({ ...allData, _script_meta: script._meta || null }, totalPenalty, typedViolations);

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
    console.log(`[ОКК] #${orderId} → сделка ${scores.deal_score_pct}%, скрипт ${script.script_score_pct ?? '—'}%, штраф -${totalPenalty}, итог ${scores.total_score}%`);
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
        let candidates = (orders || []) as Array<{ order_id: number }>;

        // 2. Если нужно только пропущено, фильтруем по отсутствию оценки скрипта
        if (params?.onlyMissing && candidates.length > 0) {
            const ids = candidates.map((candidate) => candidate.order_id);
            const { data: existingScores } = await supabase
                .from('okk_order_scores')
                .select('order_id')
                .in('order_id', ids)
                .not('script_score_pct', 'is', null);

            const hasScore = new Set(((existingScores || []) as Array<{ order_id: number }>).map((score) => score.order_id));
            candidates = candidates.filter((candidate) => !hasScore.has(candidate.order_id));
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
