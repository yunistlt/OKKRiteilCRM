const QUALITY_CRITERION_LABELS: Record<string, string> = {
    lead_in_work_lt_1_day: 'Лид в работе менее суток с даты поступления',
    next_contact_not_overdue: 'Дата следующего контакта не просрочена и не сдвинута без причины',
    lead_in_work_lt_1_day_after_tz: 'Лид в работе менее суток с даты получения ТЗ',
    deal_in_status_lt_5_days: 'Сделка находится в одном статусе менее 5 дней',
    tz_received: 'ТЗ от клиента получено',
    field_buyer_filled: 'Заполнено поле «Покупатель»',
    field_product_category: 'Заполнено поле «Категория товара»',
    field_contact_data: 'Внесены контактные данные клиента',
    relevant_number_found: 'Найден релевантный номер клиента',
    field_expected_amount: 'Указана ожидаемая сумма сделки',
    field_purchase_form: 'Указана форма закупки',
    field_sphere_correct: 'Указана сфера деятельности',
    mandatory_comments: 'Добавлены обязательные комментарии',
    email_sent_no_answer: 'При отсутствии ответа клиенту отправлено письмо',
    script_greeting: 'Приветствие клиента и представление сотрудника',
    script_call_purpose: 'Обозначена цель звонка',
    script_company_info: 'Выяснено, чем занимается организация',
    script_lpr_identified: 'Выявлено лицо, принимающее решение',
    script_budget_confirmed: 'Подтверждён бюджет',
    script_urgency_identified: 'Выявлена срочность покупки',
    script_deadlines: 'Уточнены сроки поставки',
    script_tz_confirmed: 'Подтверждены параметры ТЗ',
    script_objection_general: 'Проведена работа с возражениями',
    script_objection_delays: 'При затягивании сроков выяснены конкуренты',
    script_offer_best_tech: 'Отработано преимущество по тех. характеристикам',
    script_offer_best_terms: 'Отработано преимущество по срокам',
    script_offer_best_price: 'Отработано преимущество по цене',
    script_cross_sell: 'Выполнена кросс-продажа',
    script_next_step_agreed: 'Согласован следующий шаг',
    script_dialogue_management: 'Менеджер управлял диалогом',
    script_confident_speech: 'Уверенная и грамотная речь'
};

export function formatQualityCriterionLabel(key: string): string {
    if (QUALITY_CRITERION_LABELS[key]) {
        return QUALITY_CRITERION_LABELS[key];
    }

    return key
        .replace(/^script_/, '')
        .replace(/_/g, ' ')
        .trim();
}
