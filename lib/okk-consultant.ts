// --- Product FAQ intent routing ---
// TODO: реализовать полную логику product_faq, knowledge retrieval и инъекции ответа
// Пример:
// if (detectedIntent === 'product_faq') {
//   const answer = await getProductFaqAnswer(userQuestion);
//   if (answer) return answer;
//   // fallback: "Нет ответа в базе знаний"
// }
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

export type ConsultantFormulaKey = 'deal_score_pct' | 'script_score_pct' | 'script_score' | 'total_score';

export type ConsultantSectionKey = 'quality-dashboard' | 'efficiency' | 'ai-tools' | 'rules' | 'audit' | 'system-status';

export type ConsultantReplyKind =
    | 'meta'
    | 'section'
    | 'glossary'
    | 'formula'
    | 'violations-reference'
    | 'criterion'
    | 'order-source'
    | 'score'
    | 'proof'
    | 'ambiguous'
    | 'missing'
    | 'technical'
    | 'fix'
    | 'failures'
    | 'fallback';

type ConsultantSectionTopic = {
    key: string;
    title: string;
    answer: string;
    aliases: string[];
};

type ConsultantSectionEntity = {
    key: string;
    title: string;
    answer: string;
    aliases: string[];
};

type ConsultantSectionMode = {
    key: string;
    title: string;
    answer: string;
    aliases: string[];
};

type ConsultantSectionOverview = {
    purpose: string;
    workflowTitle?: string;
    workflow?: string[];
    outcomes?: string[];
    pitfalls?: string[];
};

export type ConsultantSectionConfig = {
    key: ConsultantSectionKey;
    title: string;
    shortTitle: string;
    aliases: string[];
    summary: string;
    overviewAnswer?: string;
    overview?: ConsultantSectionOverview;
    pathPrefixes: string[];
    topics: ConsultantSectionTopic[];
    entities?: ConsultantSectionEntity[];
    modes?: ConsultantSectionMode[];
};

type PenaltyJournalEntry = {
    rule_code?: string | null;
    severity?: string | null;
    points?: number | null;
    details?: string | null;
    detected_at?: string | null;
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
} as const satisfies Record<ConsultantFormulaKey, string>;

const CONSULTANT_FORMULA_ALIASES: Record<ConsultantFormulaKey, string[]> = {
    deal_score_pct: ['deal_score_pct', 'deal score pct', 'deal score percent', 'процент сделки', 'формула deal score', 'как считается deal score'],
    script_score_pct: ['script_score_pct', 'script score pct', 'script score percent', 'процент скрипта', 'формула script score pct'],
    script_score: ['script_score', 'script score', 'балл по скрипту', 'как считается script score'],
    total_score: ['total_score', 'total score', 'итоговый балл', 'итоговый рейтинг', 'итоговый процент', 'как считается total score'],
};

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
    {
        key: 'violations',
        term: 'Нарушения',
        definition: 'Это отдельные нарушения процесса, которые система фиксирует по заказу и показывает в красной колонке. Они не равны обычным крестикам по критериям: нарушения дополнительно уменьшают итоговый total_score через штрафные баллы.',
        aliases: ['нарушения', 'кнопка нарушений', 'кнопка нарушения', 'колонка нарушений', 'столбец нарушений', 'нарушения процесса'],
    },
    {
        key: 'penalties',
        term: 'штрафы',
        definition: 'Штрафы применяются после расчета deal_score_pct и script_score_pct. Если по заказу зафиксированы нарушения процесса, итоговый total_score уменьшается на сумму штрафных пунктов.',
        aliases: ['штраф', 'штрафы', 'штрафные баллы', 'penalty', 'penalty journal'],
    },
];

export const OKK_CONSULTANT_GUIDES = [...CRITERION_GUIDES, ...SCRIPT_GUIDES];

const ALL_GUIDES = OKK_CONSULTANT_GUIDES;

function ensureSentencePunctuation(value: string): string {
    const trimmed = value.trim();
    if (!trimmed) return trimmed;
    return /[.!?]$/.test(trimmed) ? trimmed : `${trimmed}.`;
}

function decapitalizeFirst(value: string): string {
    return value.replace(/^([A-ZА-ЯЁ])/, (match) => match.toLowerCase());
}

export function formatCriterionWhyFailText(value: string): string {
    const sentence = ensureSentencePunctuation(value);
    if (!sentence) return sentence;

    if (/^(Обычно это означает, что|Это означает, что|Критерий не выполнен, если)/i.test(sentence)) {
        return sentence;
    }

    return `Обычно это означает, что ${decapitalizeFirst(sentence)}`;
}

export function formatCriterionHowToFixText(value: string): string {
    const sentence = ensureSentencePunctuation(value);
    if (!sentence) return sentence;

    if (/^(Чтобы исправить ситуацию,|Чтобы это исправить,)/i.test(sentence)) {
        return sentence;
    }

    const body = sentence.replace(/[.!?]+$/, '').trim();
    if (!body) return sentence;

    if (/^(Нужно|Следует|Стоит)\s+/i.test(body)) {
        return `Чтобы исправить ситуацию, ${decapitalizeFirst(body)}.`;
    }

    return `Чтобы исправить ситуацию, нужно ${decapitalizeFirst(body)}.`;
}

export const OKK_CONSULTANT_QUICK_QUESTIONS = {
    global: [
        'Как считается рейтинг ОКК?',
        'Что входит в итоговый балл?',
        'Как работают крестики и галочки?',
        'Что такое deal_score?',
    ],
    order: [
        'Как работает алгоритм оценки ОКК?',
        'Что означают крестики и галочки?',
        'Какие поля заказа участвуют в проверке?',
        'Откуда система берёт данные для оценки?',
        'Как читать нарушения и штрафы?',
        'Как понять, почему критерий считается выполненным?',
        'Какие источники данных использует ОКК?',
        'Как обычно проходит анализ заказа в ОКК?',
        'Что делать, если данные в CRM заполнены неполно?',
    ],
} as const;

const CONSULTANT_SECTION_CONFIGS: ConsultantSectionConfig[] = [
    {
        key: 'quality-dashboard',
        title: 'Справка по ОКК',
        shortTitle: 'Справка',
        aliases: ['окк', 'справка по окк', 'контроль качества', 'качество', 'качество заказов'],
        summary: 'Экран ОКК нужен, чтобы понять качество работы по заказам: какие критерии выполнены, где есть просадка и на каких данных основан итоговый результат.',
        overview: {
            purpose: 'Экран ОКК нужен для чтения качества работы по заказам, а не просто для просмотра крестиков и галочек.',
            workflowTitle: 'Как с ним обычно работают:',
            workflow: [
                'Сначала выбирают нужного менеджера, период или статус, чтобы сузить таблицу до нужных заказов.',
                'Затем смотрят, какие критерии выполнены, где есть провалы и как это влияет на deal score, script score и общий total score.',
                'После этого открывают детали заказа или задают вопрос Семёну, чтобы понять источник данных, логику расчёта и что именно нужно исправить.',
            ],
            outcomes: [
                'На выходе экран даёт не просто оценку, а объяснение, почему заказ выглядит сильным, слабым или спорным с точки зрения ОКК.',
            ],
        },
        overviewAnswer: [
            'Экран ОКК нужен для чтения качества работы по заказам, а не просто для просмотра крестиков и галочек.',
            '',
            'Как с ним обычно работают:',
            '1. Сначала выбирают нужного менеджера, период или статус, чтобы сузить таблицу до нужных заказов.',
            '2. Затем смотрят, какие критерии выполнены, где есть провалы и как это влияет на deal score, script score и общий total score.',
            '3. После этого открывают детали заказа или задают вопрос Семёну, чтобы понять источник данных, логику расчёта и что именно нужно исправить.',
            '',
            'Итог этого экрана — не просто оценка, а объяснение, почему заказ выглядит сильным, слабым или спорным с точки зрения ОКК.',
        ].join('\n'),
        pathPrefixes: ['/okk'],
        entities: [
            {
                key: 'deal_score',
                title: 'Deal score',
                aliases: ['deal score', 'deal_score', 'процент сделки', 'оценка сделки'],
                answer: [
                    'Deal score показывает, насколько по заказу выполнены критерии, связанные с полями сделки, SLA и базовой процессной дисциплиной.',
                    '',
                    'Как это интерпретировать:',
                    '1. Это не итоговый рейтинг, а только часть общей оценки ОКК.',
                    '2. Если deal score проседает, обычно проблема в полях CRM, сроках реакции, следующем контакте или обязательных действиях по сделке.',
                    '3. Смотреть его нужно вместе с script score и штрафами, чтобы понять, где именно просели критерии и были ли штрафы.',
                ].join('\n'),
            },
            {
                key: 'script_score',
                title: 'Script score',
                aliases: ['script score', 'script_score', 'оценка скрипта', 'процент скрипта'],
                answer: [
                    'Script score показывает, насколько разговор менеджера соответствует ожидаемому сценарию общения.',
                    '',
                    'Практический смысл:',
                    '1. Этот показатель отвечает не за поля CRM, а за качество разговора и соблюдение этапов скрипта.',
                    '2. Он собирается из критериев по приветствию, выявлению потребности, возражениям, следующему шагу и другим речевым блокам.',
                    '3. Низкий script score означает, что менеджер разговаривал с клиентом, но сделал это слабее стандарта ОКК.',
                ].join('\n'),
            },
            {
                key: 'total_score',
                title: 'Total score',
                aliases: ['total score', 'total_score', 'итоговый балл', 'итоговый рейтинг', 'итоговый процент', 'как считается total score'],
                answer: [
                    'Total score это итоговый процент ОКК после объединения deal score, script score и возможных штрафов.',
                    '',
                    'Что важно понимать:',
                    '1. Это финальная управленческая оценка заказа.',
                    '2. Она может быть ниже обеих частных оценок, если по заказу сработали отдельные нарушения и штрафы.',
                    '3. Читать total score без breakdown неудобно: для разбора причины всегда нужно смотреть, где просели критерии и были ли штрафы.',
                ].join('\n'),
            },
        ],
        topics: [
            {
                key: 'columns',
                title: 'Колонки и критерии',
                aliases: ['колонки', 'колонка', 'критерии', 'крестики', 'галочки'],
                answer: [
                    'Каждая колонка на экране ОКК отвечает не за оформление таблицы, а за конкретный критерий качества сделки, SLA или разговора.',
                    '',
                    'Как это читать в работе:',
                    '1. Верхние группы колонок разделяют логику на блоки: SLA, поля сделки, скрипт разговора и нарушения.',
                    '2. Галочка означает, что по данным CRM, истории или звонков критерий подтверждён.',
                    '3. Крестик означает либо провал критерия, либо отсутствие достаточного подтверждения в данных.',
                    '4. Процентные колонки справа собирают локальные проверки в deal_score_pct, script_score_pct и итоговый total_score.',
                    '',
                    'То есть таблица помогает быстро увидеть не только где проблема, но и в каком блоке логики она возникла.',
                ].join('\n'),
            },
            {
                key: 'filters',
                title: 'Фильтры и таблица',
                aliases: ['фильтр', 'фильтры', 'менеджеры', 'статусы', 'таблица'],
                answer: [
                    'Фильтры сверху нужны, чтобы перейти от общей картины к конкретному срезу: менеджеру, статусу или периоду.',
                    '',
                    'Что меняется после выбора фильтров:',
                    '1. Список видимых заказов в таблице.',
                    '2. Средний процент по текущему фильтру.',
                    '3. Набор заказов, по которым удобно открывать карточку и задавать Семёну точечные вопросы.',
                    '4. Пагинация, объём выборки и общая интерпретация текущего среза.',
                    '',
                    'Практически это экран для поиска проблемного сегмента, а не только для листания всех заказов подряд.',
                ].join('\n'),
            },
            {
                key: 'analysis-flow',
                title: 'Как проходит анализ',
                aliases: ['алгоритм', 'как проходит анализ', 'логика расчета', 'как считается', 'источники данных'],
                answer: [
                    'ОКК анализирует заказ не одной общей формулой, а набором проверок по данным сделки, истории, звонков и AI-разбору транскрипций.',
                    '',
                    'Как это устроено в целом:',
                    '1. Система берёт поля заказа, историю изменений, звонки и связанные технические признаки.',
                    '2. По каждому критерию применяется правило, вычисление или AI-проверка в зависимости от его типа.',
                    '3. Результаты собираются в deal_score_pct, script_score_pct и общий total_score.',
                    '4. Отдельно могут применяться штрафы за нарушения процесса, если они зафиксированы системой.',
                    '',
                    'Смысл этого объяснения в том, чтобы понять, почему система пришла к оценке, а не просто увидеть итоговый процент.',
                ].join('\n'),
            },
        ],
    },
    {
        key: 'efficiency',
        title: 'Эффективность',
        shortTitle: 'Эффективность',
        aliases: ['эффективность', 'скорость', 'эффективность работы', 'ключевые заказы'],
        summary: 'Раздел эффективности нужен, чтобы видеть скорость обработки ключевых лидов, просрочки и нагрузку менеджеров по времени в работе.',
        overview: {
            purpose: 'Раздел эффективности нужен для контроля скорости работы, а не качества разговора или полноты заполнения карточки.',
            workflowTitle: 'Как с ним обычно работают:',
            workflow: [
                'Смотрят, сколько ключевых заказов попало в работу за период.',
                'Проверяют, где появились просрочки, зависания или длинное время до реакции.',
                'Спускаются в детальный отчёт, чтобы понять, у какого менеджера именно возникает перегрузка или нарушение SLA.',
            ],
            outcomes: [
                'На выходе экран даёт управленческую картину по скорости и приоритетам: где уже есть риск упущения сделки и кому нужен разбор.',
            ],
        },
        overviewAnswer: [
            'Раздел эффективности нужен для контроля скорости работы, а не качества разговора или полноты заполнения карточки.',
            '',
            'Как с ним обычно работают:',
            '1. Смотрят, сколько ключевых заказов попало в работу за период.',
            '2. Проверяют, где появились просрочки, зависания или длинное время до реакции.',
            '3. Затем спускаются в детальный отчёт, чтобы понять, у какого менеджера именно возникает перегрузка или нарушение SLA.',
            '',
            'На выходе этот экран даёт управленческую картину по скорости и приоритетам: где уже есть риск упущения сделки и кому нужен разбор.',
        ].join('\n'),
        pathPrefixes: ['/efficiency'],
        entities: [
            {
                key: 'overdue',
                title: 'Просрочено',
                aliases: ['просрочено', 'просрочка', 'просроченные'],
                answer: [
                    'Показатель «Просрочено» нужен как быстрый сигнал, что часть ключевых заказов уже вышла за ожидаемый срок обработки.',
                    '',
                    'Как читать это в работе:',
                    '1. Это не просто счётчик, а индикатор риска потерять темп по важным лидам.',
                    '2. Если значение растёт, дальше нужно смотреть детальный отчёт по менеджерам и времени реакции.',
                    '3. Сам по себе этот показатель не объясняет причину, а показывает, где уже нужен разбор.',
                ].join('\n'),
            },
        ],
        topics: [
            {
                key: 'priority',
                title: 'Ключевые заказы',
                aliases: ['ключевые заказы', 'приоритетные лиды', 'просрочено', 'до 14:00'],
                answer: [
                    'Блок «Ключевые заказы» нужен, чтобы быстро понять, как менеджеры справляются с наиболее важными лидами и где уже есть риск упустить срок.',
                    '',
                    'Что означают карточки:',
                    '1. «Всего ключевых» показывает объём приоритетных лидов в выбранном периоде.',
                    '2. «Просрочено» показывает количество заказов, где менеджер не уложился в ожидаемый срок обработки.',
                    '3. Если список пустой, значит по текущему диапазону дат система не нашла подходящих заказов или ключевые лиды не попали под фильтр.',
                    '4. Детальный отчёт ниже раскладывает это по менеджерам и среднему времени на заказ.',
                    '',
                    'Это не просто счётчик заказов, а ранний сигнал о провале скорости работы.',
                ].join('\n'),
            },
            {
                key: 'empty-state',
                title: 'Почему нет данных',
                aliases: ['нет заказов', 'данные не найдены', 'пусто', 'ничего не найдено'],
                answer: [
                    'Если экран эффективности пустой, это не всегда ошибка. Чаще всего система просто не нашла заказов, подходящих под выбранный период или условия расчёта.',
                    '',
                    'Проверьте по порядку:',
                    '1. Диапазон дат в правом верхнем фильтре.',
                    '2. Есть ли в этом окне реальные события по ключевым заказам.',
                    '3. Отработал ли API эффективности без ошибок.',
                    '4. Не очищен ли список из-за слишком узкого фильтра по периоду.',
                    '',
                    'То есть пустой экран сначала читается как вопрос к фильтру и данным, а не как доказательство, что у менеджеров всё хорошо.',
                ].join('\n'),
            },
        ],
    },
    {
        key: 'ai-tools',
        title: 'AI Инструменты',
        shortTitle: 'AI Tools',
        aliases: ['ai инструменты', 'ai tools', 'согласование отмен', 'согласования отмен', 'отмены', 'роутинг отмен'],
        summary: 'Экран AI Инструменты нужен для ручного и безопасного запуска AI-роутинга заказов: здесь выбирают режим запуска, объём очереди и смотрят, какое решение предлагает модель.',
        overview: {
            purpose: 'AI Инструменты нужны для ручного запуска AI-роутинга по заказам, а не для общего просмотра справки по модели.',
            workflowTitle: 'Как с этим экраном обычно работают:',
            workflow: [
                'Сначала смотрят размер очереди и задают лимит, чтобы понять, сколько заказов пойдёт в текущий прогон.',
                'Затем выбирают режим: безопасный тест без записи в CRM или обучение с возможностью корректировки результата.',
                'После запуска смотрят, какое решение предлагает модель, какой статус она рекомендует, насколько она уверена в выводе и на чём основано обоснование.',
            ],
            outcomes: [
                'Итог этого экрана это контролируемый разбор того, что ИИ решил сделать с заказом и можно ли этому решению доверять.',
            ],
        },
        overviewAnswer: [
            'AI Инструменты нужны для ручного запуска AI-роутинга по заказам, а не для общего просмотра справки по модели.',
            '',
            'Как с этим экраном обычно работают:',
            '1. Сначала смотрят размер очереди и задают лимит, чтобы понять, сколько заказов пойдёт в текущий прогон.',
            '2. Затем выбирают режим: безопасный тест без записи в CRM или обучение с возможностью корректировки результата.',
            '3. После запуска смотрят, какое решение предлагает модель, какой статус она рекомендует, насколько она уверена в выводе и на чём основано обоснование.',
            '',
            'Итог этого экрана — не просто запуск модели, а контролируемый разбор того, что ИИ решил сделать с заказом и можно ли этому решению доверять.',
        ].join('\n'),
        pathPrefixes: ['/settings/ai-tools'],
        entities: [
            {
                key: 'confidence',
                title: 'Confidence',
                aliases: ['confidence', 'conf', 'уверенность модели', 'уверенность'],
                answer: [
                    'Confidence показывает не качество заказа, а уверенность модели в том статусе, который она предлагает.',
                    '',
                    'Как это использовать:',
                    '1. Высокая уверенность означает, что по доступным признакам модель видит решение как сравнительно устойчивое.',
                    '2. Низкая уверенность не равна ошибке, но это повод внимательнее смотреть обоснование и проверять решение вручную.',
                    '3. Интерпретировать confidence нужно вместе с reasoning, а не отдельно от него.',
                ].join('\n'),
            },
            {
                key: 'reasoning',
                title: 'Обоснование',
                aliases: ['обоснование', 'reasoning', 'почему решила', 'почему выбрал статус'],
                answer: [
                    'Обоснование показывает, на каких признаках модель построила рекомендацию по статусу.',
                    '',
                    'Практический смысл:',
                    '1. Это главный текст для ручной проверки решения ИИ.',
                    '2. По нему оператор понимает, действительно ли модель опиралась на релевантные сигналы, а не на слабый косвенный признак.',
                    '3. Если обоснование выглядит спорным, решение стоит проверять вручную или использовать режим обучения.',
                ].join('\n'),
            },
        ],
        modes: [
            {
                key: 'test',
                title: 'Тестовый запуск',
                aliases: ['тест', 'dry run', 'тестовый режим'],
                answer: [
                    'Тестовый запуск нужен, чтобы безопасно посмотреть решение модели без записи изменений в CRM.',
                    '',
                    'Когда использовать:',
                    '1. Когда нужно проверить поведение модели на реальной очереди без риска повлиять на рабочие статусы.',
                    '2. Когда сравнивают качество новой логики или нового prompt.',
                    '3. Когда оператору нужно увидеть решение и confidence, но не применять его автоматически.',
                ].join('\n'),
            },
            {
                key: 'training',
                title: 'Обучение',
                aliases: ['обучение', 'режим обучения'],
                answer: [
                    'Режим обучения нужен, чтобы оператор мог корректировать спорные решения модели и сохранять такие случаи как обучающие примеры.',
                    '',
                    'Практический сценарий:',
                    '1. Модель предлагает статус и обоснование.',
                    '2. Оператор проверяет их и при необходимости вносит корректировку.',
                    '3. Исправленный кейс становится полезным материалом для дальнейшей настройки качества роутинга.',
                ].join('\n'),
            },
        ],
        topics: [
            {
                key: 'routing',
                title: 'Как работает роутинг',
                aliases: ['роутинг', 'routing', 'решение ии', 'обоснование', 'conf'],
                answer: [
                    'AI-роутинг в этом разделе нужен, чтобы по очереди заказов получить предложенный следующий статус и понять, почему модель выбрала именно его.',
                    '',
                    'Что здесь важно читать:',
                    '1. «Решение ИИ» — целевой статус, который рекомендует модель.',
                    '2. «Conf» — confidence, то есть уверенность модели в выбранном статусе.',
                    '3. «Обоснование» — текстовая причина, на каких данных модель построила вывод.',
                    '4. Если решение выглядит спорным, оператор может проверить его вручную и в режиме обучения скорректировать статус и комментарий.',
                    '',
                    'То есть экран показывает не только итоговое решение ИИ, но и пригодность этого решения для рабочей обработки.',
                ].join('\n'),
            },
            {
                key: 'modes',
                title: 'Тест и обучение',
                aliases: ['тест', 'dry run', 'обучение', 'лимит', 'очередь'],
                answer: [
                    'Верхняя панель нужна, чтобы управлять режимом запуска и безопасностью прогона, а не только выбирать технические параметры.',
                    '',
                    'Как использовать переключатели:',
                    '1. «Тест» включает dry run: решение считается, но запись в CRM не происходит.',
                    '2. «Обучение» разрешает вручную корректировать решение модели и сохранять этот пример как обучающий.',
                    '3. «Лимит» ограничивает, сколько заказов брать в текущий прогон, чтобы запуск был контролируемым.',
                    '4. «Очередь» показывает общий объём заказов, доступных для обработки AI-роутингом.',
                    '',
                    'Практически это значит: для безопасной проверки используют «Тест», а для накопления корректных примеров и донастройки модели — «Обучение».',
                ].join('\n'),
            },
        ],
    },
    {
        key: 'system-status',
        title: 'Статус систем',
        shortTitle: 'Статус систем',
        aliases: ['статус систем', 'системный статус', 'мониторинг', 'дашборд статуса', 'очереди', 'ретраи', 'задержки'],
        summary: 'Экран статуса систем нужен, чтобы быстро понять, где realtime-пайплайн работает нормально, где копится очередь и какой сервис сейчас тормозит цепочку.',
        overview: {
            purpose: 'Экран статуса систем нужен не для разработческой отладки, а для быстрого ответа на вопрос, где норма, а где уже начинается риск задержки или сбоя.',
            workflowTitle: 'Как с ним обычно работают:',
            workflow: [
                'Сначала смотрят верхние карточки задержек, чтобы понять, где именно выросло время прохождения по цепочке.',
                'Затем переходят к блоку с узким местом и очередями, чтобы увидеть, какая очередь упёрлась в backlog, повторы или dead letter.',
                'После этого открывают ручной запуск нужного fallback-сервиса или задают Семёну вопрос, насколько ситуация критична.',
            ],
            outcomes: [
                'Итог этого экрана это понятная картина: что работает, что тормозит и что делать оператору прямо сейчас.',
            ],
        },
        overviewAnswer: [
            'Экран статуса систем нужен не для разработческой отладки, а для быстрого ответа на простой вопрос: где сейчас норма, а где уже начинается риск задержки или сбоя.',
            '',
            'Как им обычно пользуются:',
            '1. Сначала смотрят верхние карточки задержек, чтобы понять, где именно выросло время прохождения по цепочке.',
            '2. Затем переходят к блоку с узким местом и очередями, чтобы увидеть, какая очередь упёрлась в backlog, повторы или dead letter.',
            '3. После этого открывают ручной запуск нужного fallback-сервиса или задают Семёну вопрос, что именно означает текущая метрика и насколько ситуация критична.',
            '',
            'Итог этого экрана — не просто цифры, а понятная картина: что работает, что тормозит и что делать оператору прямо сейчас.',
        ].join('\n'),
        pathPrefixes: ['/settings/status'],
        entities: [
            {
                key: 'p95',
                title: 'P95',
                aliases: ['p95', 'sla p95', 'цель sla p95'],
                answer: [
                    'P95 показывает почти худший нормальный сценарий по времени прохождения, то есть насколько медленными оказываются самые проблемные, но ещё не единичные кейсы.',
                    '',
                    'Как это читать в работе:',
                    '1. Если p95 растёт, значит существенная часть событий уже застревает, даже если средняя картина ещё выглядит терпимо.',
                    '2. Именно поэтому p95 важнее для операционного контроля, чем только p50.',
                    '3. Цель SLA p95 показывает порог, после которого задержка уже считается проблемой, а не просто рабочим шумом.',
                ].join('\n'),
            },
            {
                key: 'dead-letter',
                title: 'Dead letter',
                aliases: ['dead letter', 'дед леттер', 'упало в dead letter'],
                answer: [
                    'Dead letter показывает задачи, которые выпали из нормального контура обработки и уже не восстановятся сами обычными ретраями.',
                    '',
                    'Практический смысл:',
                    '1. Это не просто временная задержка, а признак, что задаче уже нужно отдельное внимание.',
                    '2. Рост dead letter означает, что часть пайплайна не справляется автоматически.',
                    '3. Такой сигнал полезно читать вместе с очередями и причинами ретраев, чтобы понять, где именно произошло устойчивое выпадение.',
                ].join('\n'),
            },
            {
                key: 'hotspot',
                title: 'Главное узкое место',
                aliases: ['главное узкое место', 'узкое место прямо сейчас', 'hotspot'],
                answer: [
                    'Карточка «Главное узкое место прямо сейчас» показывает очередь или сервис, которые сильнее всего тормозят текущую цепочку.',
                    '',
                    'Как это использовать:',
                    '1. Это краткий operational summary, куда смотреть в первую очередь.',
                    '2. Она собирает в одну строку backlog, processing, dead letter и возраст самой старой задачи.',
                    '3. По ней удобно понять, где именно оператору или разработчику начинать разбор, не читая все очереди подряд.',
                ].join('\n'),
            },
        ],
        modes: [
            {
                key: 'fallback-mode',
                title: 'Fallback mode',
                aliases: ['fallback mode', 'fallback режим', 'realtime pipeline off', 'realtime pipeline on', 'compat layer'],
                answer: [
                    'Fallback mode показывает, работает ли система в полном near-realtime контуре или временно опирается на запасной механизм синхронизации.',
                    '',
                    'Когда это важно:',
                    '1. Если realtime pipeline ON, система старается обновлять данные в нормальном потоке с минимальной задержкой.',
                    '2. Если включён fallback mode, это значит, что часть обновлений может доходить обходным или более медленным путём.',
                    '3. Этот режим нужен для понимания, является ли текущая задержка локальной проблемой очереди или следствием того, что весь контур работает в запасной схеме.',
                ].join('\n'),
            },
        ],
        topics: [
            {
                key: 'latency',
                title: 'Задержки и время прохождения',
                aliases: ['задержка', 'latency', 'p50', 'p95', 'время прохождения', 'скорость цепочки'],
                answer: [
                    'Карточки задержек показывают не просто техническое время, а сколько реально занимает прохождение события через ключевые этапы обработки.',
                    '',
                    'Как это читать:',
                    '1. p50 — типичное время, которое видит половина событий.',
                    '2. p95 — почти худший нормальный случай: если он сильно растёт, значит часть заказов или звонков застревает.',
                    '3. Если вместо значения стоит n/a, значит за период просто не было достаточно новых событий для расчёта.',
                    '',
                    'Практически это нужно для ответа на вопрос: система сейчас работает быстро или уже накапливает задержку по конкретному этапу.',
                ].join('\n'),
            },
            {
                key: 'queues',
                title: 'Очереди и узкие места',
                aliases: ['очередь', 'backlog', 'queued', 'processing', 'hotspot', 'узкое место'],
                answer: [
                    'Блок очередей нужен, чтобы понять, где задачи просто ждут своей очереди, а где уже появился реальный затор.',
                    '',
                    'Что означают показатели:',
                    '1. «Ждут запуска» — сколько задач ещё не взято в работу.',
                    '2. «Сейчас обрабатывается» — сколько задач уже выполняется прямо сейчас.',
                    '3. «Самая старая задача» — как долго в очереди лежит самый старый элемент.',
                    '4. «Узкое место пайплайна» — очередь, которая сейчас сильнее всего тормозит общую цепочку.',
                    '',
                    'Если простыми словами, этот блок отвечает на вопрос: проблема уже случилась или это пока просто рабочая нагрузка.',
                ].join('\n'),
            },
            {
                key: 'retries',
                title: 'Повторы и dead letter',
                aliases: ['retry', 'повторы', 'dead letter', 'ошибки', 'неуспешные задачи'],
                answer: [
                    'Блок повторов нужен, чтобы отделить временную нестабильность от настоящей поломки.',
                    '',
                    'Как это понимать:',
                    '1. Повторы означают, что задача не завершилась сразу и система пытается прогнать её ещё раз.',
                    '2. Причина повтора показывает, это проблема ожидания зависимости, лимита, сети, AI-сервиса или общая ошибка.',
                    '3. Dead letter означает, что задача выбыла из нормального контура и сама уже не восстановится без отдельного внимания.',
                    '',
                    'То есть этот блок нужен, чтобы понять: система временно отыгрывает сбой сама или оператору уже пора вмешиваться.',
                ].join('\n'),
            },
        ],
    },
    {
        key: 'rules',
        title: 'Правила ОКК',
        shortTitle: 'Правила',
        aliases: ['правила', 'rules', 'настройка правил', 'движок правил', 'регламенты', 'правила окк'],
        summary: 'Экран правил нужен, чтобы управлять автоматическими проверками нарушений: включать правила, настраивать пороги, тестировать логику и смотреть, как правило связано с журналом нарушений.',
        overview: {
            purpose: 'Экран правил нужен для управления автоматическими проверками нарушений, а не для точечного разбора одной сделки.',
            workflowTitle: 'Как с этим экраном обычно работают:',
            workflow: [
                'Сначала открывают список активных правил и смотрят, какие проверки сейчас реально участвуют в боевом контуре.',
                'Затем у нужного правила проверяют описание, критичность, параметры, уведомления и связь с журналом нарушений.',
                'Если логику нужно изменить, создают новую версию правила, прогоняют синтетический тест или аудит истории и только потом включают обновлённый вариант.',
            ],
            outcomes: [
                'На выходе экран даёт контроль над тем, какие нарушения система ищет, насколько строго она их трактует и как безопасно менять логику без поломки production-контура.',
            ],
            pitfalls: [
                'Изменение правила идёт через новую версию, а не через тихое редактирование старой.',
                'Синтетический тест и аудит истории отвечают на разные вопросы: первый проверяет логику на искусственном кейсе, второй показывает, как правило повело бы себя на реальных событиях.',
            ],
        },
        overviewAnswer: [
            'Экран правил нужен для управления автоматическими проверками нарушений, а не для точечного разбора одной сделки.',
            '',
            'Как с этим экраном обычно работают:',
            '1. Сначала открывают список активных правил и смотрят, какие проверки сейчас реально участвуют в боевом контуре.',
            '2. Затем у нужного правила проверяют описание, критичность, параметры, уведомления и связь с журналом нарушений.',
            '3. Если логику нужно изменить, создают новую версию правила, прогоняют синтетический тест или аудит истории и только потом включают обновлённый вариант.',
            '',
            'На выходе экран даёт контроль над тем, какие нарушения система ищет, насколько строго она их трактует и как безопасно менять логику без поломки production-контура.',
        ].join('\n'),
        pathPrefixes: ['/settings/rules'],
        entities: [
            {
                key: 'severity',
                title: 'Критичность',
                aliases: ['критичность', 'severity', 'уровень критичности'],
                answer: [
                    'Критичность показывает, насколько серьёзным считается нарушение с точки зрения процесса и приоритета реакции.',
                    '',
                    'Как это использовать:',
                    '1. Это не вероятность ошибки, а управленческий приоритет самого правила.',
                    '2. Чем выше критичность, тем внимательнее нужно относиться к уведомлениям и к попаданию правила в рабочий контур.',
                    '3. Критичность удобно читать вместе с количеством срабатываний, чтобы понять, это редкий серьёзный инцидент или массовая системная проблема.',
                ].join('\n'),
            },
            {
                key: 'notify_telegram',
                title: 'Telegram уведомления',
                aliases: ['telegram', 'уведомления', 'notify', 'notify telegram', 'telegram уведомления'],
                answer: [
                    'Переключатель Telegram управляет тем, будет ли правило отправлять уведомления о своих срабатываниях во внешний канал.',
                    '',
                    'Практический смысл:',
                    '1. Это не влияет на сам факт проверки правила, а влияет на способ доставки сигнала о нарушении.',
                    '2. Включать его стоит для действительно важных правил, иначе канал быстро превращается в шум.',
                    '3. Настройку нужно оценивать вместе с критичностью и частотой срабатывания.',
                ].join('\n'),
            },
            {
                key: 'violation_count',
                title: 'Счётчик нарушений',
                aliases: ['счетчик нарушений', 'violation count', 'сколько нарушений', 'бейдж нарушений'],
                answer: [
                    'Счётчик нарушений рядом с правилом показывает, сколько кейсов сейчас связано именно с этой проверкой.',
                    '',
                    'Как его читать:',
                    '1. Это быстрый индикатор реального следа правила в данных, а не просто описание логики.',
                    '2. По нему удобно понять, правило вообще работает в бою или почти не срабатывает.',
                    '3. По клику обычно переходят в журнал нарушений, чтобы разобрать реальные случаи.',
                ].join('\n'),
            },
        ],
        modes: [
            {
                key: 'synthetic-test',
                title: 'Синтетический тест',
                aliases: ['синтетический тест', 'проверить логику', 'тест правила', 'synthetic test'],
                answer: [
                    'Синтетический тест нужен, чтобы быстро проверить логику правила на искусственно созданном кейсе до включения в боевой контур.',
                    '',
                    'Когда использовать:',
                    '1. Когда правило только что создано или сильно изменено.',
                    '2. Когда нужно убедиться, что trigger и conditions собираются в ожидаемый сценарий.',
                    '3. Когда нельзя сразу опираться на реальные historical данные и нужен безопасный быстрый smoke-check логики.',
                ].join('\n'),
            },
            {
                key: 'history-audit',
                title: 'Аудит истории',
                aliases: ['аудит истории', 'audit history', 'проверка истории', 'сколько дней проверить'],
                answer: [
                    'Аудит истории нужен, чтобы прогнать правило по реальным событиям за выбранный период и понять, как оно повело бы себя на исторических данных.',
                    '',
                    'Практический смысл:',
                    '1. Это проверка не на искусственном, а на боевом материале.',
                    '2. Она помогает увидеть шумные ложные срабатывания или, наоборот, случаи, которые правило пропускает.',
                    '3. Перед включением новой версии правила аудит истории полезен как более надёжный барьер, чем одиночный тест.',
                ].join('\n'),
            },
        ],
        topics: [
            {
                key: 'versions',
                title: 'Активные и архивные версии',
                aliases: ['архив', 'активные', 'версии', 'immutable rules', 'новая версия'],
                answer: [
                    'Правила в этом экране живут как версионируемые сущности: рабочая версия активна, старые попадают в архив.',
                    '',
                    'Что это значит в работе:',
                    '1. Изменение логики лучше читать как выпуск новой версии, а не как тихое переписывание старой.',
                    '2. Активная вкладка показывает, какие правила реально участвуют в боевой проверке сейчас.',
                    '3. Архив нужен, чтобы видеть исторические редакции и не терять след изменений.',
                    '',
                    'Это снижает риск незаметно сломать проверку и потерять понимание, по какой редакции правило раньше работало.',
                ].join('\n'),
            },
            {
                key: 'logic',
                title: 'Trigger, conditions и параметры',
                aliases: ['trigger', 'conditions', 'условия', 'параметры', 'logic', 'порог'],
                answer: [
                    'Логика правила делится на trigger, conditions и параметры: сначала система понимает, когда запускаться, затем что именно считать нарушением.',
                    '',
                    'Как это читать:',
                    '1. Trigger отвечает за момент проверки, например смену стадии, событие по заказу или звонок.',
                    '2. Conditions описывают, какие признаки должны совпасть, чтобы нарушение действительно зафиксировалось.',
                    '3. Параметры задают числовые пороги и ограничения, например длительность звонка или SLA в минутах.',
                    '',
                    'То есть правило это не одна фраза, а связка момента запуска, условий и порогов.',
                ].join('\n'),
            },
            {
                key: 'violations-link',
                title: 'Связь с журналом нарушений',
                aliases: ['журнал нарушений', 'violations', 'показать нарушения', 'нарушения по правилу'],
                answer: [
                    'Экран правил и журнал нарушений связаны напрямую: правила задают логику проверки, а журнал показывает реальные случаи, где эта логика сработала.',
                    '',
                    'Как этим пользуются:',
                    '1. На экране правил смотрят, какое правило активно и сколько у него срабатываний.',
                    '2. Затем переходят в журнал нарушений, чтобы разобрать конкретные кейсы по этому правилу.',
                    '3. По итогам решают, нужно ли менять параметры, ослаблять условие или, наоборот, ужесточать проверку.',
                    '',
                    'Практически это контур обратной связи между конфигурацией правила и его реальным поведением.',
                ].join('\n'),
            },
        ],
    },
    {
        key: 'audit',
        title: 'Аудит консультанта',
        shortTitle: 'Аудит',
        aliases: ['аудит', 'аудит консультанта', 'аудит семена', 'trace', 'трейсы'],
        summary: 'Экран аудита нужен для разбора того, как именно Семён сформировал ответ: какой был вопрос, какой intent определился и когда сработал fallback.',
        overview: {
            purpose: 'Аудит консультанта нужен администраторам и разработчикам, чтобы разбирать качество ответов Семёна, а не для повседневной работы с заказами.',
            workflowTitle: 'Как им пользуются:',
            workflow: [
                'Находят проблемный или интересующий trace по вопросу, времени и intent.',
                'Открывают историю сообщений, чтобы посмотреть, что спросил пользователь и что ответил консультант.',
                'Проверяют технические признаки: thread, criterion, fallback, preview ответа и другие поля диагностики.',
            ],
            outcomes: [
                'На выходе этот экран помогает понять, почему ответ получился сильным, слабым или нестабильным, и что нужно исправить в knowledge, prompt или routing.',
            ],
        },
        overviewAnswer: [
            'Аудит консультанта нужен администраторам и разработчикам, чтобы разбирать качество ответов Семёна, а не для повседневной работы с заказами.',
            '',
            'Как им пользуются:',
            '1. Находят проблемный или интересующий trace по вопросу, времени и intent.',
            '2. Открывают историю сообщений, чтобы посмотреть, что спросил пользователь и что ответил консультант.',
            '3. Проверяют технические признаки: thread, criterion, fallback, preview ответа и другие поля диагностики.',
            '',
            'На выходе этот экран помогает понять, почему ответ получился сильным, слабым или нестабильным, и что нужно исправить в knowledge, prompt или routing.',
        ].join('\n'),
        pathPrefixes: ['/okk/audit'],
        entities: [
            {
                key: 'intent',
                title: 'Intent',
                aliases: ['intent', 'интент', 'тип вопроса'],
                answer: [
                    'Intent показывает, как система классифицировала вопрос пользователя перед выбором сценария ответа.',
                    '',
                    'Практический смысл:',
                    '1. По intent видно, пошёл ли запрос в режим why, score, proof, section или другой branch routing.',
                    '2. Если intent определился странно, проблема может быть не в знаниях, а в маршрутизации вопроса.',
                    '3. Для аудита это один из главных признаков, почему консультант ответил именно так, а не иначе.',
                ].join('\n'),
            },
            {
                key: 'answer-preview',
                title: 'Answer Preview',
                aliases: ['answer preview', 'preview', 'превью ответа', 'preview ответа'],
                answer: [
                    'Answer Preview это короткая сохранённая версия ответа, которую удобно смотреть прямо в списке или в правой панели без полного разворачивания треда.',
                    '',
                    'Как использовать:',
                    '1. По preview быстро понимают, про что был ответ и выглядит ли он вообще адекватно.',
                    '2. Это ускоряет первичный triage, когда нужно просмотреть много trace подряд.',
                    '3. Но для точного разбора preview недостаточно: при спорном кейсе всегда нужно открыть полную историю сообщений.',
                ].join('\n'),
            },
            {
                key: 'thread-id',
                title: 'Thread ID',
                aliases: ['thread id', 'thread_id', 'тред', 'ид треда'],
                answer: [
                    'Thread ID нужен, чтобы понимать, к какой ветке диалога относится конкретный trace и какие сообщения связаны между собой одним контекстом.',
                    '',
                    'Что это даёт в аудите:',
                    '1. Можно отличить одиночный вопрос от длинного продолженного разговора.',
                    '2. Легче увидеть, не исказил ли ответ контекст предыдущих сообщений.',
                    '3. Thread ID полезен, когда нужно расследовать поведение консультанта не по одному сообщению, а по всей ветке.',
                ].join('\n'),
            },
        ],
        topics: [
            {
                key: 'trace',
                title: 'Trace и история',
                aliases: ['trace', 'trace id', 'thread', 'история', 'сообщения'],
                answer: [
                    'Trace и история в аудите нужны, чтобы восстановить полный контекст ответа: что спросили, в какой ветке это произошло и что именно сохранилось в логе.',
                    '',
                    'Как читать экран:',
                    '1. Слева список последних trace с вопросом, временем и intent.',
                    '2. По центру открывается цепочка сообщений конкретного trace.',
                    '3. Справа показываются технические детали: trace_id, thread_id, criterion и признак fallback.',
                    '4. Это экран диагностики качества ответов, а не рабочая таблица оценки заказов.',
                    '',
                    'Если коротко, trace здесь нужен как точка входа в расследование конкретного ответа Семёна.',
                ].join('\n'),
            },
            {
                key: 'fallback',
                title: 'Fallback и intent',
                aliases: ['fallback', 'intent', 'preview', 'answer preview'],
                answer: [
                    'В аудите intent показывает, как система поняла тип вопроса, а fallback показывает, пришлось ли подключать LLM-резерв вместо полностью структурированного ответа.',
                    '',
                    'Что это значит на практике:',
                    '1. intent помогает понять, какой режим объяснения выбрал консультант: why, score, proof и так далее.',
                    '2. fallback означает, что структурных данных не хватило для жёсткого ответа и была задействована модель.',
                    '3. answer preview — короткая версия ответа, сохранённая в аудит-логе.',
                    '',
                    'Это нужно, чтобы отделять ошибки контента от ошибок маршрутизации и понимать, где именно просел ответ.',
                ].join('\n'),
            },
        ],
    },
];

function includesAny(text: string, items: string[]): boolean {
    return items.some((item) => text.includes(normalized(item)));
}

function escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function isSectionExplanationPrompt(text: string): boolean {
    return includesAny(text, [
        'этот экран',
        'этот раздел',
        'эта страница',
        'что это за раздел',
        'как работает этот раздел',
        'что здесь',
        'что показывает',
        'для чего этот экран',
        'при чем тут',
        'я спрашиваю про',
        'я спрашивал про',
        'я имею в виду',
        'не про заказ',
        'не про рейтинг',
        'про раздел',
        'про экран',
    ]);
}

function isOverviewQuestion(text: string, explicitSection: ConsultantSectionConfig | null): boolean {
    return !text
        || isSectionExplanationPrompt(text)
        || Boolean(explicitSection && (text.includes('раздел') || text.includes('экран') || text.includes('страниц') || text.includes('что это') || text.includes('как работает')));
}

function isEmptyStateQuestion(text: string): boolean {
    return text.includes('здесь') && includesAny(text, ['нет заказов', 'нет данных', 'пусто', 'ничего не найдено']);
}

function buildStructuredSectionOverview(section: ConsultantSectionConfig): string | null {
    if (!section.overview) return null;

    const blocks = [section.overview.purpose];

    if (section.overview.workflow?.length) {
        blocks.push('', section.overview.workflowTitle || 'Как с ним обычно работают:');
        blocks.push(...section.overview.workflow.map((step, index) => `${index + 1}. ${step}`));
    }

    if (section.entities?.length) {
        blocks.push('', 'Ключевые элементы:');
        blocks.push(...section.entities.slice(0, 3).map((entity) => `- ${entity.title}: ${firstSentence(entity.answer)}`));
    }

    if (section.overview.outcomes?.length) {
        blocks.push('', ...section.overview.outcomes);
    }

    if (section.overview.pitfalls?.length) {
        blocks.push('', 'Что важно не перепутать:');
        blocks.push(...section.overview.pitfalls.map((item) => `- ${item}`));
    }

    return blocks.join('\n');
}

export function formatConsultantSectionOverview(section: ConsultantSectionConfig): string {
    const structuredOverview = buildStructuredSectionOverview(section);
    if (structuredOverview) {
        return structuredOverview;
    }

    if (section.overviewAnswer) {
        return section.overviewAnswer;
    }

    return [
        `${section.title}.`,
        '',
        section.summary,
        '',
        `На этом экране я могу помогать по темам: ${section.topics.map((topic) => topic.title).join(', ')}.`,
    ].join('\n');
}

function getSectionOverview(section: ConsultantSectionConfig): string {
    return formatConsultantSectionOverview(section);
}

function buildAIToolsSelectionAnswer(selection: Record<string, any>): string {
    const orderId = selection.order_id || selection.orderId || '—';
    const currentStatus = selection.current_status_name || selection.currentStatusName || selection.from_status || selection.fromStatus || '—';
    const targetStatus = selection.to_status_name || selection.toStatusName || selection.to_status || selection.toStatus || '—';
    const confidence = selection.confidence ?? '—';
    const managerName = selection.manager_name || selection.managerName || '—';
    const reasoning = selection.reasoning || 'Обоснование не передано.';

    return [
        `По заказу #${orderId} в AI Инструментах сейчас выбран результат роутинга.`,
        '',
        `Менеджер: ${managerName}.`,
        `Текущий статус: ${currentStatus}.`,
        `Решение ИИ: ${targetStatus}.`,
        `Confidence: ${confidence === '—' ? confidence : `${confidence}%`}.`,
        '',
        `Обоснование модели: ${reasoning}`,
    ].join('\n');
}

export function getConsultantSectionConfig(sectionKey?: string | null): ConsultantSectionConfig {
    return CONSULTANT_SECTION_CONFIGS.find((section) => section.key === sectionKey) || CONSULTANT_SECTION_CONFIGS[0];
}

export function getConsultantSectionByPath(pathname?: string | null): ConsultantSectionConfig {
    const currentPath = pathname || '/okk';
    return CONSULTANT_SECTION_CONFIGS
        .slice()
        .sort((left, right) => Math.max(...right.pathPrefixes.map((prefix) => prefix.length)) - Math.max(...left.pathPrefixes.map((prefix) => prefix.length)))
        .find((section) => section.pathPrefixes.some((prefix) => currentPath.startsWith(prefix))) || CONSULTANT_SECTION_CONFIGS[0];
}

export function findConsultantSectionMention(message?: string | null): ConsultantSectionConfig | null {
    const lower = normalized(message || '');
    if (!lower) return null;

    let bestMatch: { section: ConsultantSectionConfig; score: number } | null = null;

    for (const section of CONSULTANT_SECTION_CONFIGS) {
        const candidates = [section.title, section.shortTitle, ...section.aliases];

        for (const candidate of candidates) {
            const normalizedCandidate = normalized(candidate);
            const index = lower.indexOf(normalizedCandidate);
            if (index === -1) continue;

            let score = normalizedCandidate.length;
            const contextualPatterns = [
                new RegExp(`(?:раздел|экран|страниц(?:а|ы)|вкладк(?:а|и))\\s+${escapeRegExp(normalizedCandidate)}`),
                new RegExp(`(?:про|спрашиваю про|спрашивал про|имею в виду)\\s+${escapeRegExp(normalizedCandidate)}`),
            ];

            if (contextualPatterns.some((pattern) => pattern.test(lower))) {
                score += 100;
            }

            if (!bestMatch || score > bestMatch.score) {
                bestMatch = { section, score };
            }
        }
    }

    return bestMatch?.section || null;
}

function firstSentence(value: string): string {
    const compact = value.replace(/\s+/g, ' ').trim();
    if (!compact) return 'Описание пока не заполнено.';
    const match = compact.match(/^.*?[.!?](?:\s|$)/);
    return match ? match[0].trim() : compact;
}

function scoreAliasMatch(text: string, aliases: string[]): number {
    let score = 0;

    for (const alias of aliases) {
        const normalizedAlias = normalized(alias);
        if (!normalizedAlias || !text.includes(normalizedAlias)) continue;
        score = Math.max(score, normalizedAlias.length);
        if (text === normalizedAlias) {
            score += 100;
        }
        if (text.includes(`что значит ${normalizedAlias}`) || text.includes(`что такое ${normalizedAlias}`)) {
            score += 30;
        }
        if (text.includes(`почему ${normalizedAlias}`)) {
            score += 20;
        }
    }

    return score;
}

function findBestSectionEntity(section: ConsultantSectionConfig, text: string): ConsultantSectionEntity | null {
    if (!section.entities?.length) return null;

    let bestMatch: { entity: ConsultantSectionEntity; score: number } | null = null;

    for (const entity of section.entities) {
        const score = scoreAliasMatch(text, entity.aliases);
        if (!score) continue;
        if (!bestMatch || score > bestMatch.score) {
            bestMatch = { entity, score };
        }
    }

    return bestMatch?.entity || null;
}

function findBestSectionMode(section: ConsultantSectionConfig, text: string): ConsultantSectionMode | null {
    if (!section.modes?.length) return null;

    let bestMatch: { mode: ConsultantSectionMode; score: number } | null = null;

    for (const mode of section.modes) {
        const score = scoreAliasMatch(text, mode.aliases);
        if (!score) continue;
        if (!bestMatch || score > bestMatch.score) {
            bestMatch = { mode, score };
        }
    }

    return bestMatch?.mode || null;
}

export function buildSectionAnswer(sectionKey?: string | null, message?: string, selection?: Record<string, any> | null): string | null {
    const defaultSection = getConsultantSectionConfig(sectionKey);
    const explicitSection = findConsultantSectionMention(message);
    const lower = normalized(message || '');

    const hasDefaultSectionSignal = Boolean(
        findBestSectionEntity(defaultSection, lower)
        || findBestSectionMode(defaultSection, lower)
        || defaultSection.topics.find((topic) => includesAny(lower, topic.aliases))
    );

    const section = explicitSection && explicitSection.key !== defaultSection.key && !hasDefaultSectionSignal
        ? explicitSection
        : defaultSection;

    if (section.key === 'quality-dashboard' && lower.includes('наруш')) {
        return buildViolationsReferenceAnswer(null);
    }

    if (section.key === 'ai-tools' && selection && includesAny(lower, ['решение ии', 'роутинг', 'routing', 'conf', 'обоснование', 'почему решил', 'почему выбрал', 'почему здесь', 'статус', 'не прош'])) {
        return buildAIToolsSelectionAnswer(selection);
    }

    const matchedEntity = findBestSectionEntity(section, lower);
    if (matchedEntity) {
        return matchedEntity.answer;
    }

    const matchedMode = findBestSectionMode(section, lower);
    if (matchedMode) {
        return matchedMode.answer;
    }

    const matchedTopic = section.topics.find((topic) => includesAny(lower, topic.aliases));
    if (matchedTopic) {
        return matchedTopic.answer;
    }

    if (isOverviewQuestion(lower, explicitSection) || isEmptyStateQuestion(lower)) {
        return getSectionOverview(section);
    }

    return null;
}

export function sanitizeConsultantContextForRole(params: {
    order: ConsultantOrder;
    evidence: OrderEvidence;
    role?: string | null;
}): { order: ConsultantOrder; evidence: OrderEvidence } {
    return {
        order: sanitizeOrderForRole(params.order, params.role),
        evidence: sanitizeEvidenceForRole(enrichEvidenceWithOrder(params.order, params.evidence), params.role),
    };
}

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

function getPenaltyJournal(order: ConsultantOrder): PenaltyJournalEntry[] {
    const penaltyJournal = order.score_breakdown?._meta?.penalty_journal;
    return Array.isArray(penaltyJournal) ? penaltyJournal : [];
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

export function isFormulaQuestion(question: string): boolean {
    const haystack = normalized(question);
    return haystack.includes('как считается')
        || haystack.includes('как считать')
        || haystack.includes('формула')
        || haystack.includes('из чего состоит')
        || haystack.includes('как формируется');
}

export function findFormulaKey(question: string): ConsultantFormulaKey | null {
    const haystack = normalized(question);

    for (const [key, aliases] of Object.entries(CONSULTANT_FORMULA_ALIASES) as Array<[ConsultantFormulaKey, string[]]>) {
        if (haystack.includes(normalized(key)) || aliases.some((alias) => haystack.includes(normalized(alias)))) {
            return key;
        }
    }

    return null;
}

function buildFormulaInputExplanation(key: ConsultantFormulaKey): string[] {
    switch (key) {
        case 'deal_score_pct':
            return [
                'Какие входные данные участвуют: deal-критерии по ведению сделки и SLA.',
                `Сейчас в этот блок входят ${DEAL_SCORE_KEYS.length} критериев.`,
            ];
        case 'script_score_pct':
            return [
                'Какие входные данные участвуют: транскрипции звонков и AI-анализ шагов скрипта.',
                `Сейчас script score pct строится по ${SCRIPT_SCORE_KEYS.length} шагам скрипта.`,
            ];
        case 'script_score':
            return [
                'Какие входные данные участвуют: уже рассчитанный script_score_pct.',
                'Дальше процент переводится в балльную шкалу script-блока.',
            ];
        case 'total_score':
            return [
                'Какие входные данные участвуют: deal_score_pct, script_score_pct и штрафы за нарушения.',
                'Если доступна только одна часть оценки, итог строится по ней без искусственного домысливания второй.',
            ];
    }
}

export function buildFormulaExplanation(key: ConsultantFormulaKey): string {
    const formula = OKK_CONSULTANT_FORMULAS[key];

    const titleMap: Record<ConsultantFormulaKey, string> = {
        deal_score_pct: 'Формула deal_score_pct',
        script_score_pct: 'Формула script_score_pct',
        script_score: 'Формула script_score',
        total_score: 'Формула total_score',
    };

    const interpretationMap: Record<ConsultantFormulaKey, string> = {
        deal_score_pct: 'Практически это показатель того, насколько менеджер закрыл проверяемые требования по ведению сделки.',
        script_score_pct: 'Практически это показатель того, насколько разговор соответствовал ожидаемому сценарию скрипта.',
        script_score: 'Практически это перевод script-качества из процента в балльную шкалу, которая участвует в общем расчёте.',
        total_score: 'Практически это итоговая управленческая оценка заказа после объединения двух частей и применения штрафов.',
    };

    return [
        `${titleMap[key]}.`,
        '',
        `Что считается: ${formula}`,
        ...buildFormulaInputExplanation(key),
        interpretationMap[key],
    ].join('\n');
}

export function buildViolationsReferenceAnswer(order?: ConsultantOrder | null): string {
    const penaltyJournal = order ? getPenaltyJournal(order) : [];
    const totalPenalty = penaltyJournal.reduce((sum, item) => sum + Number(item?.points || 0), 0);

    const lines = [
        'Кнопка и колонка «Нарушения» показывают не крестики по чек-листу, а отдельные нарушения процесса по заказу.',
        '',
        'Что это значит:',
        '1. Красная цифра в колонке показывает, сколько нарушений система зафиксировала по заказу.',
        '2. По клику открывается список нарушений процесса с описанием, временем фиксации и штрафом в баллах.',
        '3. Эти нарушения живут отдельно от deal/script критериев и дополнительно уменьшают итоговый total_score.',
        '4. Поэтому заказ может иметь нормальные галочки по части критериев, но всё равно терять итоговый процент из-за штрафов.',
    ];

    if (!order) {
        lines.push('', 'Если нужен разбор по конкретному заказу, выберите его в таблице, и я покажу, сколько нарушений попало в расчет и какой штраф они дали.');
        return lines.join('\n');
    }

    if (penaltyJournal.length === 0) {
        lines.push(
            '',
            `По заказу #${order.order_id} в сохраненном penalty journal нарушений сейчас не видно.`,
            'Если в таблице красная кнопка есть, но в breakdown штрафов нет, нужно сверить источник списка violations на странице и сохраненный score_breakdown._meta.penalty_journal.'
        );
        return lines.join('\n');
    }

    lines.push(
        '',
        `По заказу #${order.order_id} в штрафной журнал попало ${penaltyJournal.length} нарушений, суммарный штраф: -${totalPenalty} п.`,
        '',
        'Что попало в штрафы:',
        ...penaltyJournal.slice(0, 5).map((item, index) => {
            const details = item.details || item.rule_code || 'Нарушение процесса';
            const points = Number(item.points || 0);
            const severity = item.severity ? `, severity=${item.severity}` : '';
            return `${index + 1}. ${details}. Штраф: -${points} п.${severity}`;
        })
    );

    return lines.join('\n');
}

export function getConsultantCatalog() {
    // Source of truth policy: section/formula/glossary/criterion content is authored here.
    // Seeded KB and deterministic runtime answers must stay derived from this catalog.
    return {
        quickQuestions: OKK_CONSULTANT_QUICK_QUESTIONS,
        formulas: OKK_CONSULTANT_FORMULAS,
        criteria: OKK_CONSULTANT_GUIDES,
        glossary: OKK_CONSULTANT_GLOSSARY,
        sections: CONSULTANT_SECTION_CONFIGS,
    };
}

export function isGlossaryQuestion(question: string): boolean {
    const haystack = normalized(question);
    return haystack.includes('что такое') || haystack.includes('что значит') || haystack.includes('объясни термин');
}

export function isConsultantMetaQuestion(question: string): boolean {
    const haystack = normalized(question);
    const asksAboutVision = haystack.includes('ты видишь') || haystack.includes('что ты видишь') || haystack.includes('видишь ли');
    const asksAboutCurrentUi = haystack.includes('что у меня открыто')
        || haystack.includes('открыто у меня')
        || haystack.includes('мой интерфейс')
        || haystack.includes('интерфейс')
        || haystack.includes('мой экран')
        || haystack.includes('экран')
        || haystack.includes('страницу');

    return asksAboutVision && asksAboutCurrentUi;
}

export function buildConsultantMetaAnswer(sectionTitle?: string): string {
    const sectionLine = sectionTitle ? `Сейчас я работаю в контексте раздела «${sectionTitle}».` : 'Я работаю в контексте текущего раздела ОКК.';

    return [
        'Нет, я не вижу интерфейс напрямую и не считываю экран как человек.',
        '',
        `${sectionLine} Я опираюсь на контекст страницы, выбранный заказ и данные, которые доступны системе.`,
        'Если опишете элемент интерфейса или зададите вопрос по разделу, я отвечу предметно: что означает поле, как работает экран и откуда берутся данные.',
    ].join('\n');
}

export function shouldShowOrderCards(kind: ConsultantReplyKind): boolean {
    return kind === 'criterion'
        || kind === 'order-source'
        || kind === 'score'
        || kind === 'proof'
        || kind === 'ambiguous'
        || kind === 'missing'
        || kind === 'technical'
        || kind === 'fix'
        || kind === 'failures'
        || kind === 'fallback';
}

export function getReplyCriterionKey(kind: ConsultantReplyKind, criterionKey: string | null): string | null {
    return kind === 'criterion' ? criterionKey : null;
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
    const aliases = [term.key, ...term.aliases].join(', ');

    return [
        `${term.term}.`,
        '',
        `Простыми словами: ${term.definition}`,
        '',
        `Где это полезно: этот термин нужен, когда пользователь пытается понять смысл поля, метрики или части расчёта ОКК.`,
        `Связанные обозначения: ${aliases}.`,
    ].join('\n');
}

export function buildOrderSourceExplanation(order: ConsultantOrder, evidence: OrderEvidence): string {
    const historyCount = evidence.lastHistoryEvents.length;
    const factSources = [
        evidence.facts?.buyer || evidence.facts?.company ? 'покупатель/компания' : null,
        evidence.facts?.phone ? 'телефон' : null,
        evidence.facts?.email ? 'email' : null,
        evidence.facts?.category ? 'категория' : null,
        evidence.facts?.expectedAmount || evidence.facts?.totalSum ? 'сумма/бюджет' : null,
        evidence.facts?.nextContactDate ? 'следующее касание' : null,
    ].filter(Boolean);

    const dateSources = [
        evidence.dates?.leadReceivedAt ? 'дата поступления лида' : null,
        evidence.dates?.firstContactAttemptAt ? 'первое касание' : null,
        evidence.dates?.lastHistoryEventAt ? 'последнее событие истории' : null,
    ].filter(Boolean);

    const aiBits = [
        evidence.aiEvidence?.model ? `модель ${evidence.aiEvidence.model}` : null,
        typeof evidence.aiEvidence?.transcriptLength === 'number' && evidence.aiEvidence.transcriptLength > 0 ? `длина транскрипта ${evidence.aiEvidence.transcriptLength}` : null,
        evidence.aiEvidence?.annaInsightsAvailable ? 'Anna insights доступны' : null,
    ].filter(Boolean);

    return [
        `Откуда берутся данные для оценки по заказу #${order.order_id}.`,
        '',
        'Оценка собирается из нескольких источников, а не из одного поля CRM.',
        '',
        `1. Поля заказа и клиента в CRM: ${factSources.join(', ') || 'по текущему заказу часть полей не заполнена или не загружена'}.`,
        `2. История заказа: ${historyCount} ${historyCount === 1 ? 'событие' : historyCount >= 2 && historyCount <= 4 ? 'события' : 'событий'} в истории; контрольные даты: ${dateSources.join(', ') || 'не загружены'}.`,
        `3. Звонки и транскрипции: найдено ${evidence.totalCalls} звонков, из них ${evidence.transcriptCalls} с транскрипцией.`,
        `4. AI и explainability: ${aiBits.join(', ') || 'AI-метаданные не сохранены'}.`,
        '',
        'Что система реально использует дальше: на этих данных проверяются deal-критерии, script-критерии, confidence, missing data и возможные fallback-сигналы.',
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
            return `${index + 1}. ${guide?.label || formatQualityCriterionLabel(key)}. ${guide ? formatCriterionHowToFixText(guide.howToFix) : 'Чтобы исправить ситуацию, нужно закрыть критерий фактическим действием и корректно зафиксировать его в CRM.'}`;
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
        `ai_model=${evidence.aiEvidence?.model || 'нет'}`,
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
        ? guide ? formatCriterionHowToFixText(guide.howToFix) : null
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
            `Что нужно сделать: ${formatCriterionHowToFixText(guide.howToFix)}`,
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
            `Когда это считается невыполненным: ${formatCriterionWhyFailText(guide.whyFail)}`,
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
        `Что считается нарушением: ${formatCriterionWhyFailText(guide.whyFail)}`,
        `Как исправить: ${formatCriterionHowToFixText(guide.howToFix)}`,
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
