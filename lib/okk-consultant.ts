import { formatQualityCriterionLabel } from '@/lib/quality-labels';

export type BreakdownEntry = {
    result?: boolean | null;
    reason?: string | null;
    reason_human?: string | null;
    rule_id?: string | null;
    owner?: string | null;
    group?: string | null;
    source_refs?: string[];
    source_values?: Record<string, any> | null;
    calculation_steps?: string[];
    confidence?: number | null;
    missing_data?: string[];
    recommended_fix?: string | null;
    ambiguous_explanation?: boolean;
    context_fragment?: string | null;
    model?: string | null;
    evidence_type?: 'rule' | 'ai' | 'system' | null;
    penalty_impact?: number | null;
    penalty_journal?: Array<Record<string, any>>;
};

export function isVisibleBreakdownKey(key: string): boolean {
    return !key.startsWith('_');
}

export type ConsultantOrder = {
    order_id: number;
    manager_name?: string | null;
    status_label?: string | null;
    deal_score?: number | null;
    deal_score_pct?: number | null;
    script_score?: number | null;
    script_score_pct?: number | null;
    total_score?: number | null;
    evaluator_comment?: string | null;
    calls_status?: string | null;
    calls_attempts_count?: number | null;
    calls_evaluated_count?: number | null;
    time_to_first_contact?: string | null;
    score_breakdown?: Record<string, BreakdownEntry> | null;
};

export type OrderEvidence = {
    commentCount: number;
    emailCount: number;
    totalCalls: number;
    transcriptCalls: number;
    calls: Array<{
        started_at: string | null;
        direction: string | null;
        duration_sec: number | null;
        hasTranscript: boolean;
        transcript_excerpt?: string | null;
        included_in_score?: boolean | null;
        classification?: 'human' | 'auto' | 'unknown' | null;
        classification_reason?: string | null;
        matched_by?: string | null;
    }>;
    facts?: {
        buyer?: string | null;
        company?: string | null;
        phone?: string | null;
        email?: string | null;
        totalSum?: number | null;
        category?: string | null;
        sphere?: string | null;
        purchaseForm?: string | null;
        expectedAmount?: string | number | null;
        nextContactDate?: string | null;
        status?: string | null;
    };
    dates?: {
        leadReceivedAt?: string | null;
        firstContactAttemptAt?: string | null;
        timeToFirstContact?: string | null;
        lastHistoryEventAt?: string | null;
        nextContactDate?: string | null;
    };
    calculations?: string[];
    aiEvidence?: {
        model?: string | null;
        transcriptLength?: number;
        transcriptExcerpt?: string | null;
        annaInsightsAvailable?: boolean;
        criteriaChecked?: number;
    };
    qualityFlags?: {
        ambiguousCriteria: string[];
        lowConfidenceCriteria: string[];
        fallbackCriteria: string[];
        fallbackCalls: number;
    };
    criteriaSnapshots?: Array<{
        key: string;
        label: string;
        result: boolean | null;
        confidence: number | null;
        missingData: string[];
        ambiguous: boolean;
        fallbackUsed: boolean;
        sourceValues?: Record<string, any> | null;
        calculationSteps?: string[];
    }>;
    tzEvidence?: {
        customerComment?: string | null;
        managerComment?: string | null;
        customFieldKeys?: string[];
    };
    lastHistoryEvents: Array<{
        field: string | null;
        created_at: string | null;
        old_value?: string | null;
        new_value?: string | null;
    }>;
};

export type ConsultantResponseCard = {
    type: 'score' | 'criterion' | 'source' | 'warning' | 'recommendation';
    title: string;
    lines: string[];
    accent?: 'emerald' | 'sky' | 'amber' | 'rose' | 'slate';
};

export type GlossaryTerm = {
    key: string;
    term: string;
    definition: string;
    aliases: string[];
};

export type CriterionGuide = {
    key: string;
    label: string;
    owner: 'Семён' | 'Игорь' | 'Максим';
    group: string;
    howChecked: string;
    dataSources: string[];
    whyPass: string;
    whyFail: string;
    howToFix: string;
    aliases: string[];
};

export const DEAL_SCORE_KEYS = [
    'tz_received',
    'field_buyer_filled',
    'field_product_category',
    'field_contact_data',
    'relevant_number_found',
    'field_expected_amount',
    'field_purchase_form',
    'field_sphere_correct',
    'mandatory_comments',
    'email_sent_no_answer',
    'lead_in_work_lt_1_day',
    'next_contact_not_overdue',
    'deal_in_status_lt_5_days',
] as const;

export const SCRIPT_SCORE_KEYS = [
    'script_greeting',
    'script_call_purpose',
    'script_company_info',
    'script_lpr_identified',
    'script_budget_confirmed',
    'script_urgency_identified',
    'script_deadlines',
    'script_tz_confirmed',
    'script_objection_general',
    'script_objection_delays',
    'script_offer_best_tech',
    'script_offer_best_terms',
    'script_offer_best_price',
    'script_cross_sell',
    'script_next_step_agreed',
    'script_dialogue_management',
    'script_confident_speech',
] as const;

const CRITERION_GUIDES: CriterionGuide[] = [
    {
        key: 'lead_in_work_lt_1_day',
        label: 'Лид в работе менее суток с даты поступления',
        owner: 'Игорь',
        group: 'SLA',
        howChecked: 'Сравнивается время поступления лида и время первого контакта менеджера.',
        dataSources: ['orders.created_at', 'raw_telphin_calls.started_at', 'order_history_log.occurred_at'],
        whyPass: 'Первое касание произошло не позже 24 часов от момента поступления лида.',
        whyFail: 'Первое касание произошло позже 24 часов либо система не нашла своевременное действие менеджера.',
        howToFix: 'Нужно обеспечить первое касание в пределах суток и корректно фиксировать звонок или действие в CRM.',
        aliases: ['лид в работе', 'менее суток', 'первое касание', 'sla'],
    },
    {
        key: 'next_contact_not_overdue',
        label: 'Дата следующего контакта не просрочена',
        owner: 'Игорь',
        group: 'SLA',
        howChecked: 'Проверяется, что дата следующего контакта не раньше текущей даты.',
        dataSources: ['raw_payload.customFields.next_contact_date', 'raw_payload.customFields.data_kontakta'],
        whyPass: 'Дата следующего контакта актуальна или не задана.',
        whyFail: 'Дата следующего контакта просрочена относительно текущего дня.',
        howToFix: 'Обновить дату следующего контакта и зафиксировать корректный следующий шаг в CRM.',
        aliases: ['следующий контакт', 'просрочена дата', 'дата контакта'],
    },
    {
        key: 'deal_in_status_lt_5_days',
        label: 'Сделка находится в одном статусе менее 5 дней',
        owner: 'Игорь',
        group: 'SLA',
        howChecked: 'Считается, сколько дней прошло с последней смены статуса.',
        dataSources: ['order_history_log.occurred_at', 'orders.created_at'],
        whyPass: 'Статус обновлялся недавно и сделка не зависла.',
        whyFail: 'Сделка слишком долго находится в одном статусе.',
        howToFix: 'Нужно продвинуть сделку по воронке или обновить статус после реального следующего шага.',
        aliases: ['5 дней', 'зависла', 'одном статусе'],
    },
    {
        key: 'tz_received',
        label: 'ТЗ от клиента получено',
        owner: 'Семён',
        group: 'Поля и ведение',
        howChecked: 'Сначала ищутся признаки ТЗ в полях заказа, затем в комментариях через AI-проверку.',
        dataSources: ['raw_payload.customFields', 'raw_payload.customerComment', 'raw_payload.managerComment'],
        whyPass: 'Нашлись размеры, температура, тип нагрева или другие признаки достаточного ТЗ.',
        whyFail: 'В полях и комментариях не найдено достаточных параметров для коммерческого расчета.',
        howToFix: 'Добавить в заказ параметры ТЗ: размеры, температуру, тип нагрева, нагрузку, материал или модель.',
        aliases: ['тз', 'техническое задание', 'параметры камеры'],
    },
    {
        key: 'field_buyer_filled',
        label: 'Заполнено поле «Покупатель»',
        owner: 'Семён',
        group: 'Поля и ведение',
        howChecked: 'Проверяется наличие данных организации или контакта в карточке заказа.',
        dataSources: ['raw_payload.company', 'raw_payload.contact', 'raw_payload.customer'],
        whyPass: 'В заказе указаны данные покупателя или организации.',
        whyFail: 'В карточке сделки отсутствует заполненный покупатель.',
        howToFix: 'Нужно заполнить организацию или контакт клиента в стандартных полях заказа.',
        aliases: ['покупатель', 'данные организации', 'buyer'],
    },
    {
        key: 'field_product_category',
        label: 'Заполнено поле «Категория товара»',
        owner: 'Семён',
        group: 'Поля и ведение',
        howChecked: 'Проверяются товарные категории в customFields или нормализованном payload.',
        dataSources: ['raw_payload.customFields.tovarnaya_kategoriya', 'raw_payload.customFields.product_category', 'raw_payload.__normalized.productCategory'],
        whyPass: 'Категория товара явно указана в карточке заказа.',
        whyFail: 'Категория товара не найдена в ожидаемых полях заказа.',
        howToFix: 'Нужно заполнить поле категории товара в заказе тем значением, которое ожидает RetailCRM и ОКК.',
        aliases: ['категория товара', 'товарная категория', 'category'],
    },
    {
        key: 'field_contact_data',
        label: 'Внесены контактные данные клиента',
        owner: 'Семён',
        group: 'Поля и ведение',
        howChecked: 'Проверяется наличие телефона, email или телефона контакта.',
        dataSources: ['raw_payload.phone', 'raw_payload.email', 'raw_payload.contact.phones'],
        whyPass: 'У клиента есть хотя бы один доступный контактный канал.',
        whyFail: 'Не найдено телефона или email, по которому можно связаться с клиентом.',
        howToFix: 'Добавить рабочий телефон или email клиента в карточку заказа.',
        aliases: ['контактные данные', 'телефон', 'email'],
    },
    {
        key: 'relevant_number_found',
        label: 'Найден релевантный номер клиента',
        owner: 'Семён',
        group: 'Поля и ведение',
        howChecked: 'Проверяется наличие исходящих звонков, привязанных к заказу или найденных по номеру.',
        dataSources: ['call_order_matches', 'raw_telphin_calls.direction'],
        whyPass: 'Система нашла исходящие попытки связи по номеру клиента.',
        whyFail: 'Исходящих звонков по заказу не найдено.',
        howToFix: 'Нужно совершить и корректно зафиксировать попытку дозвона по релевантному номеру клиента.',
        aliases: ['релевантный номер', 'дозвон', 'исходящие звонки'],
    },
    {
        key: 'field_expected_amount',
        label: 'Указана ожидаемая сумма сделки',
        owner: 'Семён',
        group: 'Поля и ведение',
        howChecked: 'Проверяется ожидаемая сумма в customFields или totalSumm заказа.',
        dataSources: ['raw_payload.customFields.expected_amount', 'orders.totalsumm'],
        whyPass: 'В сделке есть зафиксированный бюджет или сумма.',
        whyFail: 'Сумма сделки не найдена в ожидаемых полях.',
        howToFix: 'Заполнить ожидаемую сумму сделки или привести в порядок сумму заказа.',
        aliases: ['ожидаемая сумма', 'бюджет', 'сумма сделки'],
    },
    {
        key: 'field_purchase_form',
        label: 'Указана форма закупки',
        owner: 'Семён',
        group: 'Поля и ведение',
        howChecked: 'Проверяется заполнение поля формы закупки в customFields.',
        dataSources: ['raw_payload.customFields.typ_customer_margin', 'raw_payload.customFields.vy_dlya_sebya_ili_dlya_zakazchika_priobretaete'],
        whyPass: 'Форма закупки указана в карточке заказа.',
        whyFail: 'Форма закупки не найдена в ожидаемых полях.',
        howToFix: 'Указать форму закупки в карточке заказа.',
        aliases: ['форма закупки', 'закупка'],
    },
    {
        key: 'field_sphere_correct',
        label: 'Указана сфера деятельности',
        owner: 'Семён',
        group: 'Поля и ведение',
        howChecked: 'Проверяется наличие поля сферы деятельности в customFields.',
        dataSources: ['raw_payload.customFields.sfera_deiatelnosti', 'raw_payload.customFields.sphere_of_activity'],
        whyPass: 'Сфера деятельности клиента заполнена.',
        whyFail: 'Сфера деятельности не найдена в карточке заказа.',
        howToFix: 'Заполнить сферу деятельности клиента в CRM.',
        aliases: ['сфера деятельности', 'отрасль', 'industry'],
    },
    {
        key: 'mandatory_comments',
        label: 'Добавлены обязательные комментарии',
        owner: 'Семён',
        group: 'Поля и ведение',
        howChecked: 'Считаются события заказа с типом comment.',
        dataSources: ['raw_order_events.event_type'],
        whyPass: 'В истории заказа есть комментарии менеджера.',
        whyFail: 'В истории заказа не найдено обязательных комментариев.',
        howToFix: 'Добавлять в сделку комментарии о сути диалога, возражениях и следующем шаге.',
        aliases: ['комментарии', 'обязательные комментарии', 'comment'],
    },
    {
        key: 'email_sent_no_answer',
        label: 'При отсутствии ответа клиенту отправлено письмо',
        owner: 'Семён',
        group: 'Поля и ведение',
        howChecked: 'Если дозвона нет, система ищет email-события по заказу.',
        dataSources: ['raw_telphin_calls', 'raw_order_events.event_type'],
        whyPass: 'После недозвона есть email-активность или успешный дозвон исключил потребность в письме.',
        whyFail: 'Был недозвон или отсутствие звонков, но письма клиенту не найдено.',
        howToFix: 'После недозвона отправлять email или фиксировать альтернативный канал касания.',
        aliases: ['письмо', 'email', 'нет ответа'],
    },
];

const SCRIPT_GUIDES: CriterionGuide[] = SCRIPT_SCORE_KEYS.map((key) => ({
    key,
    label: formatQualityCriterionLabel(key),
    owner: 'Максим',
    group: 'Скрипт',
    howChecked: 'Максим анализирует транскрипции звонков и оценивает соблюдение скрипта общения.',
    dataSources: ['raw_telphin_calls.transcript', 'AI-анализ script score'],
    whyPass: 'В расшифровке звонков обнаружены признаки выполнения соответствующего шага скрипта.',
    whyFail: 'В транскрипции не хватило подтверждений, что шаг скрипта был выполнен.',
    howToFix: 'Закрывать этот этап скрипта явной формулировкой в разговоре и добиваться отражения этого в транскрипции.',
    aliases: [key.replace(/^script_/, ''), formatQualityCriterionLabel(key).toLowerCase()],
}));

export const OKK_CONSULTANT_FORMULAS = {
    deal_score_pct: 'Выполненные deal-критерии / проверенные deal-критерии x 100.',
    script_score_pct: 'Процент, который возвращает AI-анализ скрипта по транскрипциям звонков.',
    script_score: 'Округление script_score_pct к шкале из 14 баллов.',
    total_score: 'Среднее между deal_score_pct и script_score_pct, если доступны обе части. Иначе берется доступная часть. После этого применяются штрафы.',
} as const;

export const OKK_CONSULTANT_GLOSSARY: GlossaryTerm[] = [
    {
        key: 'deal_score',
        term: 'deal_score',
        definition: 'Балльная часть оценки по ведению сделки. Это не процент, а число баллов, полученное из выполненных deal-критериев.',
        aliases: ['deal score', 'дел скор', 'оценка сделки'],
    },
    {
        key: 'deal_score_pct',
        term: 'deal_score_pct',
        definition: 'Процент выполнения критериев ведения сделки и SLA: выполненные критерии делятся на проверенные и умножаются на 100.',
        aliases: ['процент сделки', 'deal score percent', 'процент deal'],
    },
    {
        key: 'script_score',
        term: 'script_score',
        definition: 'Балльная часть оценки по скрипту разговора. Получается из процента соблюдения скрипта после перевода в шкалу баллов.',
        aliases: ['script score', 'скрипт скор', 'балл по скрипту'],
    },
    {
        key: 'script_score_pct',
        term: 'script_score_pct',
        definition: 'Процент соблюдения скрипта в звонках по результатам AI-анализа транскрипций.',
        aliases: ['процент скрипта', 'script percent', 'процент script'],
    },
    {
        key: 'total_score',
        term: 'total_score',
        definition: 'Итоговый процент ОКК после объединения deal_score_pct, script_score_pct и применения штрафов.',
        aliases: ['итоговый балл', 'итоговый рейтинг', 'общий score'],
    },
    {
        key: 'breakdown',
        term: 'breakdown',
        definition: 'Структурированная раскладка оценки по отдельным критериям с result, reason, source_values, confidence и другими объясняющими полями.',
        aliases: ['разбивка', 'раскладка', 'score breakdown'],
    },
    {
        key: 'sla',
        term: 'SLA',
        definition: 'Норматив по срокам реакции и движению сделки: первое касание, непросроченный следующий контакт и отсутствие зависания в статусе.',
        aliases: ['сла', 'срок реакции'],
    },
    {
        key: 'tz',
        term: 'ТЗ',
        definition: 'Техническое задание клиента: размеры, температура, тип нагрева, материал, нагрузка и другие параметры, достаточные для расчета.',
        aliases: ['техническое задание', 'tz', 'параметры заказа'],
    },
    {
        key: 'relevant_number',
        term: 'релевантный номер',
        definition: 'Номер клиента, по которому система смогла найти привязанный или fallback-звонок, пригодный для оценки попытки контакта.',
        aliases: ['релевантный номер клиента', 'номер для дозвона'],
    },
    {
        key: 'connect',
        term: 'дозвон',
        definition: 'Факт, что менеджер реально вышел на клиента: обычно это исходящий звонок, который не классифицирован как автоответчик или IVR.',
        aliases: ['дозвон до клиента', 'живой разговор'],
    },
    {
        key: 'comment',
        term: 'комментарий',
        definition: 'Событие или текст в CRM, фиксирующий суть контакта, возражения, договоренности и следующий шаг.',
        aliases: ['коммент', 'comment', 'комментарий менеджера'],
    },
    {
        key: 'next_contact',
        term: 'следующее касание',
        definition: 'Запланированная дата или действие, когда менеджер должен снова вернуться к клиенту; используется в SLA-контроле.',
        aliases: ['следующий контакт', 'next contact', 'дата следующего касания'],
    },
];

export const OKK_CONSULTANT_GUIDES = [...CRITERION_GUIDES, ...SCRIPT_GUIDES];

const ALL_GUIDES = OKK_CONSULTANT_GUIDES;

export const OKK_CONSULTANT_QUICK_QUESTIONS = {
    global: [
        'Как считается рейтинг ОКК?',
        'Что входит в итоговый балл?',
        'Как работают крестики и галочки?',
        'Что такое deal_score?',
    ],
    order: [
        'Как посчитан балл по этому заказу?',
        'Почему здесь есть крестики?',
        'Что нужно исправить менеджеру?',
        'Откуда взялись данные для оценки?',
        'Покажи доказательства по заказу',
        'Какие критерии спорные?',
        'Каких данных не хватает?',
        'Сделай технический разбор заказа',
        'Какие звонки попали в оценку?',
    ],
} as const;

function shortText(value: string | null | undefined, max = 180): string {
    if (!value) return '—';
    const normalizedValue = value.replace(/\s+/g, ' ').trim();
    if (normalizedValue.length <= max) return normalizedValue;
    return `${normalizedValue.slice(0, max - 1)}…`;
}

function formatPrimitive(value: unknown): string {
    if (value === null || value === undefined || value === '') return '—';
    if (Array.isArray(value)) return value.length > 0 ? value.map((item) => formatPrimitive(item)).join(', ') : '—';
    if (typeof value === 'object') return JSON.stringify(value);
    return String(value);
}

function formatSourceValues(sourceValues?: Record<string, any> | null): string[] {
    if (!sourceValues || typeof sourceValues !== 'object') return [];
    return Object.entries(sourceValues)
        .filter(([, value]) => value !== null && value !== undefined && value !== '')
        .map(([key, value]) => `${key}: ${formatPrimitive(value)}`);
}

function getFallbackUsed(entry?: BreakdownEntry | null): boolean {
    const sourceValues = entry?.source_values;
    if (!sourceValues || typeof sourceValues !== 'object') return false;

    const calls = Array.isArray((sourceValues as any).calls) ? (sourceValues as any).calls : [];
    return calls.some((call: any) => call?.matched_by === 'phone_fallback' || String(call?.classification_reason || '').toLowerCase().includes('fallback'));
}

export function enrichEvidenceWithOrder(order: ConsultantOrder, evidence: OrderEvidence): OrderEvidence {
    const breakdownEntries = Object.entries(order.score_breakdown || {}).filter(([key]) => isVisibleBreakdownKey(key));
    const metaEntry = order.score_breakdown?._meta;
    const scriptEntries = breakdownEntries.filter(([key]) => key.startsWith('script_'));
    const ambiguousCriteria = breakdownEntries
        .filter(([, entry]) => Boolean(entry?.ambiguous_explanation))
        .map(([key]) => key);
    const lowConfidenceCriteria = breakdownEntries
        .filter(([, entry]) => typeof entry?.confidence === 'number' && entry.confidence < 0.6)
        .map(([key]) => key);
    const fallbackCriteria = breakdownEntries
        .filter(([, entry]) => getFallbackUsed(entry))
        .map(([key]) => key);
    const fallbackCalls = breakdownEntries.reduce((acc, [, entry]) => {
        const calls = Array.isArray(entry?.source_values?.calls) ? entry?.source_values?.calls : [];
        return acc + calls.filter((call: any) => call?.matched_by === 'phone_fallback').length;
    }, 0);

    const firstSnapshotWithTranscript = scriptEntries.find(([, entry]) => entry?.context_fragment);

    return {
        ...evidence,
        dates: {
            leadReceivedAt: order.score_breakdown?.lead_in_work_lt_1_day?.source_values?.lead_received_at || null,
            firstContactAttemptAt: order.score_breakdown?.lead_in_work_lt_1_day?.source_values?.first_contact_attempt_at || null,
            timeToFirstContact: order.time_to_first_contact || order.score_breakdown?.lead_in_work_lt_1_day?.source_values?.time_to_first_contact || null,
            lastHistoryEventAt: evidence.lastHistoryEvents[0]?.created_at || null,
            nextContactDate: order.score_breakdown?.next_contact_not_overdue?.source_values?.next_contact_date || null,
        },
        calculations: Array.isArray(metaEntry?.calculation_steps) ? metaEntry.calculation_steps : [],
        aiEvidence: {
            model: firstSnapshotWithTranscript?.[1]?.model || null,
            transcriptLength: Number(scriptEntries[0]?.[1]?.source_values?.transcript_length || 0),
            transcriptExcerpt: firstSnapshotWithTranscript?.[1]?.context_fragment || null,
            annaInsightsAvailable: Boolean(scriptEntries[0]?.[1]?.source_values?.anna_insights_available),
            criteriaChecked: scriptEntries.length,
        },
        qualityFlags: {
            ambiguousCriteria,
            lowConfidenceCriteria,
            fallbackCriteria,
            fallbackCalls,
        },
        criteriaSnapshots: breakdownEntries.slice(0, 40).map(([key, entry]) => ({
            key,
            label: formatQualityCriterionLabel(key),
            result: entry?.result ?? null,
            confidence: entry?.confidence ?? null,
            missingData: entry?.missing_data || [],
            ambiguous: Boolean(entry?.ambiguous_explanation),
            fallbackUsed: getFallbackUsed(entry),
            sourceValues: entry?.source_values || null,
            calculationSteps: entry?.calculation_steps || [],
        })),
    };
}

function shouldMaskSensitiveValue(key: string): boolean {
    const lower = key.toLowerCase();
    return lower.includes('phone')
        || lower.includes('email')
        || lower.includes('comment')
        || lower.includes('transcript')
        || lower.includes('buyer')
        || lower.includes('customer')
        || lower.includes('contact')
        || lower.includes('company');
}

function maskString(value: string, key?: string): string {
    if (!value) return value;
    if (key && key.toLowerCase().includes('email')) {
        const [local, domain] = value.split('@');
        return domain ? `${local.slice(0, 1)}***@${domain}` : '***';
    }
    if (key && key.toLowerCase().includes('phone')) {
        const digits = value.replace(/\D/g, '');
        if (digits.length < 4) return '***';
        return `${digits.slice(0, 2)}***${digits.slice(-2)}`;
    }
    return `${value.slice(0, 1)}***`;
}

function sanitizeValue(value: any, parentKey?: string): any {
    if (value === null || value === undefined) return value;
    if (Array.isArray(value)) return value.map((item) => sanitizeValue(item, parentKey));
    if (typeof value === 'object') {
        return Object.fromEntries(
            Object.entries(value).map(([key, nestedValue]) => {
                if (shouldMaskSensitiveValue(key)) {
                    if (typeof nestedValue === 'string') return [key, maskString(nestedValue, key)];
                    if (Array.isArray(nestedValue)) return [key, nestedValue.map((item) => typeof item === 'string' ? maskString(item, key) : sanitizeValue(item, key))];
                }
                return [key, sanitizeValue(nestedValue, key)];
            })
        );
    }
    if (typeof value === 'string' && parentKey && shouldMaskSensitiveValue(parentKey)) {
        return maskString(value, parentKey);
    }
    return value;
}

export function sanitizeEvidenceForRole(evidence: OrderEvidence, role?: string | null): OrderEvidence {
    if (!role || role === 'admin' || role === 'okk') return evidence;

    return {
        ...evidence,
        calls: evidence.calls.map((call) => ({
            ...call,
            transcript_excerpt: call.transcript_excerpt ? maskString(call.transcript_excerpt, 'transcript_excerpt') : call.transcript_excerpt,
        })),
        facts: evidence.facts ? sanitizeValue(evidence.facts) : evidence.facts,
        tzEvidence: evidence.tzEvidence ? sanitizeValue(evidence.tzEvidence) : evidence.tzEvidence,
        criteriaSnapshots: evidence.criteriaSnapshots?.map((item) => ({
            ...item,
            sourceValues: item.sourceValues ? sanitizeValue(item.sourceValues) : item.sourceValues,
        })),
    };
}

export function sanitizeOrderForRole(order: ConsultantOrder, role?: string | null): ConsultantOrder {
    if (!role || role === 'admin' || role === 'okk') return order;

    const sanitizedBreakdown = Object.fromEntries(
        Object.entries(order.score_breakdown || {}).map(([key, entry]) => ([
            key,
            entry
                ? {
                    ...entry,
                    source_values: entry.source_values ? sanitizeValue(entry.source_values) : entry.source_values,
                    context_fragment: entry.context_fragment ? maskString(entry.context_fragment, 'context_fragment') : entry.context_fragment,
                }
                : entry,
        ]))
    );

    return {
        ...order,
        score_breakdown: sanitizedBreakdown,
    };
}

function collectVisibleBreakdown(order: ConsultantOrder) {
    return Object.entries(order.score_breakdown || {}).filter(([key]) => isVisibleBreakdownKey(key));
}

export function buildAmbiguousCriteriaSummary(order: ConsultantOrder): string {
    const ambiguous = collectVisibleBreakdown(order)
        .filter(([, entry]) => Boolean(entry?.ambiguous_explanation) || (typeof entry?.confidence === 'number' && entry.confidence < 0.6))
        .slice(0, 8);

    if (ambiguous.length === 0) {
        return `По заказу #${order.order_id} сейчас нет сохранённых критериев, помеченных как спорные или требующие ручной проверки.`;
    }

    return [
        `По заказу #${order.order_id} есть ${ambiguous.length} спорных критерия(ев), где системе нужна ручная проверка или доверие к выводу ниже нормы.`,
        '',
        ...ambiguous.map(([key, entry], index) => {
            const confidence = typeof entry?.confidence === 'number' ? `${Math.round(entry.confidence * 100)}%` : 'не сохранена';
            const missingData = entry?.missing_data?.length ? ` Не хватает: ${entry.missing_data.join(', ')}.` : '';
            return `${index + 1}. ${formatQualityCriterionLabel(key)}. ${entry?.reason || 'Причина не сохранена.'} Уверенность: ${confidence}.${missingData}`;
        }),
        '',
        'Это значит, что по этим критериям лучше открыть карточку заказа, историю и звонки, а не полагаться только на автообъяснение.',
    ].join('\n');
}

export function buildMissingDataSummary(order: ConsultantOrder): string {
    const missing = collectVisibleBreakdown(order)
        .filter(([, entry]) => Array.isArray(entry?.missing_data) && entry.missing_data.length > 0)
        .slice(0, 10);

    if (missing.length === 0) {
        return `По заказу #${order.order_id} в сохранённом breakdown нет критериев, где явно зафиксирована нехватка данных.`;
    }

    return [
        `По заказу #${order.order_id} система явно зафиксировала нехватку данных в ${missing.length} критериях.`,
        '',
        ...missing.map(([key, entry], index) => `${index + 1}. ${formatQualityCriterionLabel(key)}: ${entry?.missing_data?.join(', ') || 'список не сохранён'}.`),
        '',
        'Ограничение: пока эти данные не появятся в CRM, звонках или истории, объяснение по части критериев будет неполным.',
    ].join('\n');
}

export function buildCallEvidenceExplanation(order: ConsultantOrder, evidence: OrderEvidence): string {
    const callBreakdown = order.score_breakdown?.relevant_number_found;
    const scoreCalls = Array.isArray(callBreakdown?.source_values?.calls)
        ? callBreakdown?.source_values?.calls
        : evidence.calls;

    const lines = [
        `Какие звонки попали в оценку по заказу #${order.order_id}.`,
        '',
        'Логика отбора:',
        '1. Сначала ищутся привязанные к заказу звонки или fallback-поиск по номеру клиента.',
        '2. Для статуса дозвона важны исходящие звонки.',
        '3. Длинные звонки с транскрипцией дополнительно проверяются AI на живой разговор vs автоответчик.',
        '4. Длинный звонок без транскрипции временно считается дозвоном по fallback-логике.',
        '',
    ];

    if (!scoreCalls || scoreCalls.length === 0) {
        lines.push('Не могу доказать, какие звонки попали в оценку: по сохранённым данным такие звонки не найдены.');
        return lines.join('\n');
    }

    lines.push(...scoreCalls.slice(0, 8).map((call: any, index: number) => {
        const date = call.started_at ? new Date(call.started_at).toLocaleString('ru-RU') : 'без даты';
        const direction = call.direction === 'outgoing' ? 'исходящий' : call.direction === 'incoming' ? 'входящий' : 'неизвестно';
        const included = call.included_in_score === true ? 'вошёл в оценку' : call.included_in_score === false ? 'не вошёл в дозвон' : 'статус не зафиксирован';
        const classification = call.classification === 'human'
            ? 'живой разговор'
            : call.classification === 'auto'
                ? 'автоответчик/IVR'
                : 'классификация не сохранена';
        const reason = call.classification_reason || 'Причина классификации не сохранена.';
        const matchedBy = call.matched_by ? `Матчинг: ${call.matched_by}. ` : '';
        const excerpt = call.transcript_excerpt ? ` Фрагмент: ${shortText(call.transcript_excerpt, 120)}` : '';
        return `${index + 1}. ${date}, ${direction}, ${call.duration_sec || 0} сек. ${included}. ${classification}. ${matchedBy}Причина: ${reason}${excerpt}`;
    }));

    return lines.join('\n');
}

export function buildHistoryEvidenceExplanation(order: ConsultantOrder, evidence: OrderEvidence): string {
    const history = evidence.lastHistoryEvents;

    if (history.length === 0) {
        return `Не могу доказать вывод по истории заказа #${order.order_id}: в доступной истории не найдено событий, которыми можно подтвердить объяснение.`;
    }

    return [
        `Какие события истории повлияли на вывод по заказу #${order.order_id}.`,
        '',
        'Система опирается на историю смен статусов, комментарии, email-события и дату первого действия менеджера.',
        '',
        ...history.slice(0, 8).map((item, index) => {
            const date = item.created_at ? new Date(item.created_at).toLocaleString('ru-RU') : 'без даты';
            return `${index + 1}. ${date}. Поле ${item.field || 'unknown'}: ${item.old_value || 'пусто'} -> ${item.new_value || 'пусто'}`;
        }),
    ].join('\n');
}

function normalized(text: string): string {
    return text.toLowerCase().replace(/ё/g, 'е');
}

function getGuide(key: string): CriterionGuide | undefined {
    return ALL_GUIDES.find((item) => item.key === key);
}

export function findCriterionKey(question: string): string | null {
    const haystack = normalized(question);
    for (const guide of ALL_GUIDES) {
        if (haystack.includes(normalized(guide.key)) || haystack.includes(normalized(guide.label))) {
            return guide.key;
        }
        if (guide.aliases.some((alias) => haystack.includes(normalized(alias)))) {
            return guide.key;
        }
    }
    return null;
}

export function buildGeneralRatingExplanation(): string {
    return [
        'Рейтинг ОКК состоит из двух частей.',
        '',
        '1. Deal score: считается по критериям ведения сделки и SLA. Берутся только те критерии, которые реально удалось проверить. Процент = выполненные критерии / проверенные критерии x 100.',
        '2. Script score: считается по звонкам и соблюдению скрипта. Максим оценивает транскрипции и возвращает процент соблюдения скрипта.',
        '3. Total score: если есть обе части, итог = среднее между deal score % и script score %. Если есть только одна часть, итог берется из нее.',
        '4. Штрафы: если по заказу обнаружены нарушения, итоговый балл дополнительно уменьшается на штрафные пункты.',
        '',
        `Сейчас в deal score участвуют ${DEAL_SCORE_KEYS.length} критериев, а script score строится по ${SCRIPT_SCORE_KEYS.length} шагам скрипта с переводом процента в балл.`,
    ].join('\n');
}

export function getConsultantCatalog() {
    return {
        quickQuestions: OKK_CONSULTANT_QUICK_QUESTIONS,
        formulas: OKK_CONSULTANT_FORMULAS,
        criteria: OKK_CONSULTANT_GUIDES,
        glossary: OKK_CONSULTANT_GLOSSARY,
    };
}

export function findGlossaryTerm(question: string): GlossaryTerm | null {
    const haystack = normalized(question);

    return OKK_CONSULTANT_GLOSSARY.find((item) => {
        if (haystack.includes(normalized(item.term)) || haystack.includes(normalized(item.key))) {
            return true;
        }

        return item.aliases.some((alias) => haystack.includes(normalized(alias)));
    }) || null;
}

export function buildGlossaryAnswer(term: GlossaryTerm): string {
    return [
        `${term.term}.`,
        '',
        term.definition,
        '',
        `Связанные обозначения: ${[term.key, ...term.aliases].join(', ')}.`,
    ].join('\n');
}

export function buildOrderScoreExplanation(order: ConsultantOrder): string {
    const breakdown = order.score_breakdown || {};
    const dealConsidered = DEAL_SCORE_KEYS.filter((key) => breakdown[key]?.result !== null && breakdown[key]?.result !== undefined);
    const dealPassed = dealConsidered.filter((key) => breakdown[key]?.result === true);
    const scriptConsidered = SCRIPT_SCORE_KEYS.filter((key) => breakdown[key]?.result !== null && breakdown[key]?.result !== undefined);
    const scriptPassed = scriptConsidered.filter((key) => breakdown[key]?.result === true);

    const lines = [
        `Заказ #${order.order_id}.`,
        '',
        `Deal score: ${order.deal_score ?? 0} балл., ${order.deal_score_pct ?? '—'}%.`,
        `Проверено deal-критериев: ${dealConsidered.length} из ${DEAL_SCORE_KEYS.length}, выполнено: ${dealPassed.length}.`,
        `Script score: ${order.script_score ?? '—'} балл., ${order.script_score_pct ?? '—'}%.`,
        `Проверено script-критериев: ${scriptConsidered.length} из ${SCRIPT_SCORE_KEYS.length}, выполнено: ${scriptPassed.length}.`,
        `Итоговый total score: ${order.total_score ?? '—'}%.`,
    ];

    if (order.calls_status) {
        lines.push(`Статус звонков: ${order.calls_status}.`);
    }
    if (order.time_to_first_contact) {
        lines.push(`Время до первого касания: ${order.time_to_first_contact}.`);
    }
    if (order.evaluator_comment) {
        lines.push('', `Резюме оценщика: ${order.evaluator_comment}`);
    }

    return lines.join('\n');
}

export function buildFailedCriteriaSummary(order: ConsultantOrder): string {
    const failed = Object.entries(order.score_breakdown || {}).filter(([key, entry]) => isVisibleBreakdownKey(key) && entry?.result === false);

    if (failed.length === 0) {
        return 'По сохраненному breakdown явных проваленных критериев нет. Если итог ниже ожидаемого, нужно смотреть script score и возможные штрафы.';
    }

    return [
        `По заказу #${order.order_id} провалено ${failed.length} критериев.`,
        '',
        ...failed.slice(0, 8).map(([key, entry], index) => `${index + 1}. ${formatQualityCriterionLabel(key)}. ${entry.reason || 'Подробная причина не сохранена.'}`),
    ].join('\n');
}

export function buildImprovementPlan(order: ConsultantOrder): string {
    const failed = Object.entries(order.score_breakdown || {}).filter(([key, entry]) => isVisibleBreakdownKey(key) && entry?.result === false);

    if (failed.length === 0) {
        return 'Критичных провалов по breakdown не видно. Чтобы поднимать итог выше, имеет смысл улучшать качество разговоров и полноту фиксации данных в CRM.';
    }

    return [
        'Что нужно исправить в первую очередь:',
        '',
        ...failed.slice(0, 6).map(([key], index) => {
            const guide = getGuide(key);
            return `${index + 1}. ${guide?.label || formatQualityCriterionLabel(key)}. ${guide?.howToFix || 'Нужно закрыть критерий фактическим действием и корректно зафиксировать его в CRM.'}`;
        }),
    ].join('\n');
}

export function buildEvidenceSummary(order: ConsultantOrder, evidence: OrderEvidence): string {
    const history = evidence.lastHistoryEvents.length > 0
        ? evidence.lastHistoryEvents
            .slice(0, 5)
            .map((item, index) => `${index + 1}. ${item.field || 'unknown'} -> ${item.new_value || 'пусто'} (${item.created_at || 'без даты'})`)
            .join('\n')
        : 'История изменений не найдена.';

    const calls = evidence.calls.length > 0
        ? evidence.calls.slice(0, 5).map((call, index) => {
            const dt = call.started_at ? new Date(call.started_at).toLocaleString('ru-RU') : 'без даты';
            const state = call.included_in_score === true ? 'вошёл' : call.included_in_score === false ? 'не вошёл' : 'не классифицирован';
            return `${index + 1}. ${dt}, ${call.direction || '—'}, ${call.duration_sec || 0} сек, ${state}, ${call.classification_reason || 'без причины'}`;
        }).join('\n')
        : 'Звонки не найдены.';

    const tzEvidence = evidence.tzEvidence
        ? [
            `Комментарий клиента: ${shortText(evidence.tzEvidence.customerComment)}`,
            `Комментарий менеджера: ${shortText(evidence.tzEvidence.managerComment)}`,
            `Custom fields: ${(evidence.tzEvidence.customFieldKeys || []).join(', ') || 'нет'}`,
        ].join('\n')
        : 'Прямые доказательства по ТЗ не загружены.';

    const facts = evidence.facts
        ? [
            `Покупатель: ${formatPrimitive(evidence.facts.buyer || evidence.facts.company)}`,
            `Телефон: ${formatPrimitive(evidence.facts.phone)}`,
            `Email: ${formatPrimitive(evidence.facts.email)}`,
            `Категория: ${formatPrimitive(evidence.facts.category)}`,
            `Ожидаемая сумма: ${formatPrimitive(evidence.facts.expectedAmount || evidence.facts.totalSum)}`,
            `Следующее касание: ${formatPrimitive(evidence.facts.nextContactDate)}`,
        ].join('\n')
        : 'Фактические поля заказа не загружены.';

    const calculations = evidence.calculations?.length
        ? evidence.calculations.slice(0, 4).map((line, index) => `${index + 1}. ${line}`).join('\n')
        : 'Промежуточные расчёты не загружены.';

    const aiEvidence = evidence.aiEvidence
        ? [
            `Модель: ${formatPrimitive(evidence.aiEvidence.model)}`,
            `Длина транскрипта: ${formatPrimitive(evidence.aiEvidence.transcriptLength)}`,
            `Anna insights: ${evidence.aiEvidence.annaInsightsAvailable ? 'да' : 'нет'}`,
            `Фрагмент: ${shortText(evidence.aiEvidence.transcriptExcerpt, 140)}`,
        ].join('\n')
        : 'AI-метаданные не загружены.';

    const flags = evidence.qualityFlags
        ? [
            `Спорные критерии: ${evidence.qualityFlags.ambiguousCriteria.join(', ') || 'нет'}`,
            `Низкая уверенность: ${evidence.qualityFlags.lowConfidenceCriteria.join(', ') || 'нет'}`,
            `Fallback-критерии: ${evidence.qualityFlags.fallbackCriteria.join(', ') || 'нет'}`,
            `Fallback-звонков: ${evidence.qualityFlags.fallbackCalls}`,
        ].join('\n')
        : 'Флаги качества объяснения не загружены.';

    return [
        `Доказательства по заказу #${order.order_id}.`,
        '',
        `Комментариев в истории: ${evidence.commentCount}.`,
        `Email-событий: ${evidence.emailCount}.`,
        `Найдено звонков: ${evidence.totalCalls}.`,
        `Из них с транскрипцией: ${evidence.transcriptCalls}.`,
        `Статус звонков в оценке: ${order.calls_status || 'неизвестно'}.`,
        '',
        'Какие звонки использованы:',
        calls,
        '',
        'Что нашлось по ТЗ:',
        tzEvidence,
        '',
        'Фактические данные заказа:',
        facts,
        '',
        'Промежуточные расчеты:',
        calculations,
        '',
        'AI-источники решения:',
        aiEvidence,
        '',
        'Флаги качества объяснения:',
        flags,
        '',
        'Последние изменения в истории заказа:',
        history,
    ].join('\n');
}

export function buildTechnicalExplanation(order: ConsultantOrder, evidence: OrderEvidence): string {
    const failed = Object.entries(order.score_breakdown || {})
        .filter(([key, entry]) => isVisibleBreakdownKey(key) && entry?.result === false)
        .slice(0, 8)
        .map(([key, entry]) => `${key}: result=false; reason=${entry.reason || 'нет'}`)
        .join('\n');

    return [
        `Технический разбор заказа #${order.order_id}.`,
        '',
        `deal_score_pct=${order.deal_score_pct ?? '—'}`,
        `script_score_pct=${order.script_score_pct ?? '—'}`,
        `total_score=${order.total_score ?? '—'}`,
        `calls_status=${order.calls_status || '—'}`,
        `calls_attempts_count=${order.calls_attempts_count ?? '—'}`,
        `calls_evaluated_count=${order.calls_evaluated_count ?? '—'}`,
        `comment_count=${evidence.commentCount}`,
        `email_count=${evidence.emailCount}`,
        `total_calls=${evidence.totalCalls}`,
        `transcript_calls=${evidence.transcriptCalls}`,
        `lead_received_at=${evidence.dates?.leadReceivedAt || '—'}`,
        `first_contact_attempt_at=${evidence.dates?.firstContactAttemptAt || '—'}`,
        `next_contact_date=${evidence.dates?.nextContactDate || '—'}`,
        `ai_model=${evidence.aiEvidence?.model || '—'}`,
        `ai_transcript_length=${evidence.aiEvidence?.transcriptLength ?? '—'}`,
        `ambiguous_criteria=${evidence.qualityFlags?.ambiguousCriteria.join(',') || '—'}`,
        `fallback_criteria=${evidence.qualityFlags?.fallbackCriteria.join(',') || '—'}`,
        '',
        'Итоговые шаги расчета:',
        ...(evidence.calculations?.slice(0, 5) || ['Нет сохраненных шагов расчета.']),
        '',
        'Проваленные критерии:',
        failed || 'Нет сохраненных проваленных критериев.',
    ].join('\n');
}

export function buildResponseCards(params: {
    order: ConsultantOrder;
    mode: 'why' | 'source' | 'fix' | 'score' | 'failures' | 'proof' | 'technical' | 'general' | 'ambiguous' | 'missing';
    criterionKey?: string | null;
    evidence?: OrderEvidence | null;
}): ConsultantResponseCard[] {
    const { order, mode, criterionKey, evidence } = params;
    const cards: ConsultantResponseCard[] = [
        {
            type: 'score',
            title: 'Счет заказа',
            accent: 'emerald',
            lines: [
                `Deal: ${order.deal_score_pct ?? '—'}% (${order.deal_score ?? '—'} б.)`,
                `Script: ${order.script_score_pct ?? '—'}% (${order.script_score ?? '—'} б.)`,
                `Total: ${order.total_score ?? '—'}%`,
            ],
        },
    ];

    const breakdown = criterionKey ? order.score_breakdown?.[criterionKey] : null;
    const guide = criterionKey ? getGuide(criterionKey) : null;

    if (criterionKey) {
        cards.push({
            type: 'criterion',
            title: guide?.label || formatQualityCriterionLabel(criterionKey),
            accent: breakdown?.result === false ? 'rose' : breakdown?.result === true ? 'emerald' : 'slate',
            lines: [
                `Статус: ${breakdown?.result === true ? 'галочка' : breakdown?.result === false ? 'крестик' : 'неопределён'}`,
                `Причина: ${breakdown?.reason || 'не сохранена'}`,
            ],
        });
    }

    if (mode === 'proof' || mode === 'source' || criterionKey) {
        const sourceLines = criterionKey
            ? [
                ...(guide?.dataSources?.length ? [`Источники: ${guide.dataSources.join('; ')}`] : []),
                ...formatSourceValues(breakdown?.source_values).slice(0, 4),
            ]
            : [
                `Звонков найдено: ${evidence?.totalCalls ?? 0}`,
                `С транскрипцией: ${evidence?.transcriptCalls ?? 0}`,
                `Комментариев: ${evidence?.commentCount ?? 0}`,
                `Email-событий: ${evidence?.emailCount ?? 0}`,
            ];

        if (sourceLines.length > 0) {
            cards.push({
                type: 'source',
                title: criterionKey ? 'Источник данных' : 'Факты заказа',
                accent: 'sky',
                lines: sourceLines,
            });
        }
    }

    if (mode === 'ambiguous') {
        const ambiguous = collectVisibleBreakdown(order)
            .filter(([, entry]) => Boolean(entry?.ambiguous_explanation) || (typeof entry?.confidence === 'number' && entry.confidence < 0.6))
            .slice(0, 4)
            .map(([key, entry]) => `${formatQualityCriterionLabel(key)}: ${entry?.reason || 'нужна ручная проверка'}`);

        if (ambiguous.length > 0) {
            cards.push({
                type: 'warning',
                title: 'Спорные критерии',
                accent: 'amber',
                lines: ambiguous,
            });
        }
    }

    if (mode === 'missing' || breakdown?.missing_data?.length || breakdown?.ambiguous_explanation) {
        const warningLines = mode === 'missing'
            ? collectVisibleBreakdown(order)
                .filter(([, entry]) => Array.isArray(entry?.missing_data) && entry.missing_data.length > 0)
                .slice(0, 4)
                .map(([key, entry]) => `${formatQualityCriterionLabel(key)}: ${entry?.missing_data?.join(', ') || 'данные не перечислены'}`)
            : [
                ...(breakdown?.missing_data?.length ? [`Не хватает: ${breakdown.missing_data.join(', ')}`] : []),
                ...(breakdown?.ambiguous_explanation ? ['Вывод помечен как спорный и требует ручной проверки.'] : []),
            ];

        if (warningLines.length > 0) {
            cards.push({
                type: 'warning',
                title: 'Предупреждение',
                accent: 'amber',
                lines: warningLines,
            });
        }
    }

    const recommendation = criterionKey
        ? guide?.howToFix || null
        : mode === 'failures' || mode === 'fix'
            ? buildImprovementPlan(order)
            : null;

    if (recommendation) {
        cards.push({
            type: 'recommendation',
            title: 'Что делать',
            accent: 'rose',
            lines: recommendation.split('\n').filter(Boolean).slice(0, 5),
        });
    }

    return cards;
}

export function buildCriterionExplanation(params: {
    order: ConsultantOrder;
    criterionKey: string;
    mode: 'why' | 'source' | 'fix' | 'general';
    evidence?: OrderEvidence | null;
}): string {
    const { order, criterionKey, mode, evidence } = params;
    const guide = getGuide(criterionKey);
    const breakdown = order.score_breakdown?.[criterionKey];
    const label = guide?.label || formatQualityCriterionLabel(criterionKey);

    if (!guide) {
        return `${label}. Подробный справочник по этому критерию пока не собран, но в breakdown сохранено следующее объяснение: ${breakdown?.reason || 'объяснение отсутствует'}.`;
    }

    const resultLabel = breakdown?.result === true ? 'галочка' : breakdown?.result === false ? 'крестик' : 'нейтральный результат';
    const reason = breakdown?.reason || 'Сохраненное текстовое обоснование для этого критерия отсутствует.';
    const sourceValueLines = formatSourceValues(breakdown?.source_values);
    const contextLine = breakdown?.context_fragment ? `Фрагмент контекста: ${shortText(breakdown.context_fragment, 260)}` : null;
    const missingLine = breakdown?.missing_data && breakdown.missing_data.length > 0
        ? `Чего не хватило системе: ${breakdown.missing_data.join(', ')}.`
        : null;

    if (mode === 'source') {
        const sourceBits = [...guide.dataSources];
        if (criterionKey === 'mandatory_comments' && evidence) {
            sourceBits.push(`raw_order_events comment count = ${evidence.commentCount}`);
        }
        if (criterionKey === 'email_sent_no_answer' && evidence) {
            sourceBits.push(`raw_order_events email count = ${evidence.emailCount}`);
            sourceBits.push(`звонков по заказу = ${evidence.totalCalls}`);
        }
        if (criterionKey === 'relevant_number_found' && evidence) {
            sourceBits.push(`звонков по заказу = ${evidence.totalCalls}`);
        }

        return [
            `${label}.`,
            '',
            `Факт: сейчас сохранён результат ${resultLabel}.`,
            `Источник результата: ${guide.howChecked}`,
            `Используемые данные: ${sourceBits.join('; ')}.`,
            `Сохраненное обоснование: ${reason}`,
            ...(sourceValueLines.length > 0 ? ['', 'Зафиксированные значения:', ...sourceValueLines] : []),
            ...(contextLine ? [contextLine] : []),
            ...(missingLine ? [`Ограничение: ${missingLine.replace(/^Чего не хватило системе:\s*/, '')}`] : []),
        ].join('\n');
    }

    if (mode === 'fix') {
        return [
            `${label}.`,
            '',
            `Сейчас по критерию стоит ${resultLabel}.`,
            `Почему: ${reason}`,
            `Что нужно сделать: ${guide.howToFix}`,
        ].join('\n');
    }

    if (mode === 'general') {
        return [
            `${label}.`,
            '',
            `Кто проверяет: ${guide.owner}.`,
            `Как проверяется: ${guide.howChecked}`,
            `На каких данных: ${guide.dataSources.join('; ')}.`,
            `Когда это считается выполненным: ${guide.whyPass}`,
            `Когда это считается невыполненным: ${guide.whyFail}`,
        ].join('\n');
    }

    return [
        `${label}.`,
        '',
        `Факт: сейчас по критерию стоит ${resultLabel}.`,
        `Почему: ${reason}`,
        ...(sourceValueLines.length > 0 ? ['', 'Какие данные реально повлияли:', ...sourceValueLines] : []),
        ...(contextLine ? [contextLine] : []),
        ...(missingLine ? [`Ограничение: ${missingLine.replace(/^Чего не хватило системе:\s*/, '')}`] : []),
        `Как правило работает: ${guide.howChecked}`,
        `Что считается нормой: ${guide.whyPass}`,
        `Что считается нарушением: ${guide.whyFail}`,
        `Как исправить: ${guide.howToFix}`,
    ].join('\n');
}

export function buildOrderContextForLLM(order: ConsultantOrder, evidence?: OrderEvidence | null): string {
    const breakdown = Object.entries(order.score_breakdown || {})
        .filter(([key]) => isVisibleBreakdownKey(key))
        .slice(0, 30)
        .map(([key, entry]) => `${formatQualityCriterionLabel(key)}: ${entry.result === true ? 'да' : entry.result === false ? 'нет' : 'неизвестно'}; reason=${entry.reason || 'нет'}`)
        .join('\n');

    const evidenceText = evidence
        ? [
            `commentCount=${evidence.commentCount}`,
            `emailCount=${evidence.emailCount}`,
            `totalCalls=${evidence.totalCalls}`,
            `transcriptCalls=${evidence.transcriptCalls}`,
            `buyer=${evidence.facts?.buyer || evidence.facts?.company || 'нет'}`,
            `phone=${evidence.facts?.phone || 'нет'}`,
            `expectedAmount=${formatPrimitive(evidence.facts?.expectedAmount || evidence.facts?.totalSum)}`,
            `leadReceivedAt=${evidence.dates?.leadReceivedAt || 'нет'}`,
            `firstContactAttemptAt=${evidence.dates?.firstContactAttemptAt || 'нет'}`,
            `aiModel=${evidence.aiEvidence?.model || 'нет'}`,
            `ambiguousCriteria=${evidence.qualityFlags?.ambiguousCriteria.join('|') || 'нет'}`,
            `fallbackCriteria=${evidence.qualityFlags?.fallbackCriteria.join('|') || 'нет'}`,
            `calls=${evidence.calls.slice(0, 3).map((call) => `${call.direction}:${call.duration_sec || 0}:${call.classification || 'unknown'}`).join(' | ') || 'нет'}`,
            `history=${evidence.lastHistoryEvents.map((item) => `${item.field}:${item.new_value || ''}`).join(' | ') || 'нет'}`,
        ].join('\n')
        : 'нет дополнительного evidence';

    return [
        `order_id=${order.order_id}`,
        `manager=${order.manager_name || '—'}`,
        `status=${order.status_label || '—'}`,
        `deal_score_pct=${order.deal_score_pct ?? '—'}`,
        `script_score_pct=${order.script_score_pct ?? '—'}`,
        `total_score=${order.total_score ?? '—'}`,
        `calls_status=${order.calls_status || '—'}`,
        `calls_attempts=${order.calls_attempts_count ?? '—'}`,
        `calls_evaluated=${order.calls_evaluated_count ?? '—'}`,
        '',
        'breakdown:',
        breakdown,
        '',
        'evidence:',
        evidenceText,
    ].join('\n');
}
