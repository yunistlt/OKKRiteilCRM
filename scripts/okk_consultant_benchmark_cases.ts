export type BenchmarkCase = {
    id: string;
    category: 'reference' | 'proof' | 'missing' | 'ambiguous' | 'historical' | 'paraphrase' | 'ui' | 'section';
    description: string;
    expectedFragments: string[];
    forbiddenFragments?: string[];
};

export const OKK_CONSULTANT_BENCHMARK_CASES: BenchmarkCase[] = [
    {
        id: 'general-rating-formula',
        category: 'reference',
        description: 'Общее объяснение рейтинга должно раскрывать две части оценки и штрафы.',
        expectedFragments: ['Deal score', 'Script score', 'Штрафы'],
    },
    {
        id: 'glossary-total-score',
        category: 'reference',
        description: 'Справка по total_score должна объяснять итоговую природу метрики.',
        expectedFragments: ['total_score', 'Итоговый процент ОКК'],
    },
    {
        id: 'glossary-sla-definition',
        category: 'reference',
        description: 'Вопрос что такое SLA должен возвращать определение термина, а не уходить в частный критерий.',
        expectedFragments: ['SLA', 'Норматив по срокам реакции'],
        forbiddenFragments: ['Лид в работе менее суток с даты поступления'],
    },
    {
        id: 'missing-data-explicit-limitation',
        category: 'missing',
        description: 'Ответ по нехватке данных должен явно содержать ограничение.',
        expectedFragments: ['нехватку данных', 'Ограничение:'],
    },
    {
        id: 'ambiguous-confidence',
        category: 'ambiguous',
        description: 'Спорные критерии должны показывать уверенность и ручную проверку.',
        expectedFragments: ['ручная проверка', 'Уверенность'],
    },
    {
        id: 'proof-no-history',
        category: 'proof',
        description: 'Если истории нет, консультант должен честно сказать, что не может доказать вывод.',
        expectedFragments: ['Не могу доказать', 'истории'],
    },
    {
        id: 'proof-no-calls',
        category: 'proof',
        description: 'Если звонков нет, консультант должен честно сказать, что не может доказать попадание звонков.',
        expectedFragments: ['Не могу доказать', 'звонки'],
    },
    {
        id: 'criterion-source-explicit-fact',
        category: 'reference',
        description: 'Source-объяснение по критерию должно отделять факт и ограничение.',
        expectedFragments: ['Факт:', 'Источник результата:'],
    },
    {
        id: 'violations-button-reference',
        category: 'ui',
        description: 'Справка по кнопке нарушений не должна превращаться в список проваленных критериев.',
        expectedFragments: ['Кнопка и колонка «Нарушения»', 'отдельные нарушения процесса', 'уменьшают итоговый total_score'],
        forbiddenFragments: ['провалено 24 критерия', 'Что нужно исправить в первую очередь'],
    },
    {
        id: 'section-ai-tools-overview',
        category: 'section',
        description: 'Общий вопрос по AI Tools должен объяснять назначение экрана и сценарий использования, а не перечислять термины.',
        expectedFragments: ['ручного запуска AI-роутинга', 'Как с этим экраном обычно работают', 'какое решение предлагает модель'],
        forbiddenFragments: ['очередь, dry run, обучение, confidence', 'Экран ручного и тестового запуска AI-роутинга заказов:'],
    },
    {
        id: 'section-ai-tools-explicit-followup',
        category: 'section',
        description: 'Если пользователь явно говорит, что спрашивает про раздел Согласование отмен, ответ должен вернуться к AI Tools, а не к рейтингу ОКК.',
        expectedFragments: ['AI Инструменты нужны для ручного запуска AI-роутинга', 'Как с этим экраном обычно работают'],
        forbiddenFragments: ['Рейтинг ОКК состоит из двух частей', 'Выберите сделку в таблице ОКК'],
    },
    {
        id: 'section-quality-overview',
        category: 'section',
        description: 'Общий вопрос по экрану ОКК должен объяснять смысл и рабочий сценарий, а не быть подписью раздела.',
        expectedFragments: ['для чтения качества работы по заказам', 'Как с ним обычно работают', 'почему заказ выглядит сильным, слабым или спорным'],
        forbiddenFragments: ['Справочный раздел по экрану ОКК', 'что означают колонки, поля, источники данных'],
    },
    {
        id: 'section-audit-overview',
        category: 'section',
        description: 'Общий вопрос по аудиту должен объяснять, кому и зачем нужен экран диагностики.',
        expectedFragments: ['нужен администраторам и разработчикам', 'Как им пользуются', 'исправить в knowledge, prompt или routing'],
        forbiddenFragments: ['trace-id, история сообщений, intent, fallback', 'Экран аудита ответов Семёна'],
    },
    {
        id: 'meta-ui-visibility',
        category: 'reference',
        description: 'Meta-вопрос про видимость интерфейса должен честно обозначать ограничение и не уходить в заказ.',
        expectedFragments: ['не вижу интерфейс напрямую', 'контексте раздела', 'вопрос по разделу'],
        forbiddenFragments: ['Заказ #', 'отсутствуют данные для расчета рейтинга'],
    },
    {
        id: 'order-source-overview',
        category: 'reference',
        description: 'Source-вопрос без критерия должен объяснять источники оценки по заказу детерминированно.',
        expectedFragments: ['Поля заказа и клиента в CRM', 'История заказа', 'Звонки и транскрипции', 'AI и explainability'],
        forbiddenFragments: ['Deal score: 54%', 'Script score: 0%'],
    },
    {
        id: 'historical-old-format-safe',
        category: 'historical',
        description: 'Старый breakdown без rich metadata не должен ронять объяснение.',
        expectedFragments: ['Факт:', 'Как правило работает'],
        forbiddenFragments: ['undefined', 'null; reason='],
    },
    {
        id: 'paraphrase-same-criterion-a',
        category: 'paraphrase',
        description: 'Первая формулировка вопроса о критерии relevant_number_found.',
        expectedFragments: ['релевантный номер', 'Как правило работает'],
    },
    {
        id: 'paraphrase-same-criterion-b',
        category: 'paraphrase',
        description: 'Вторая формулировка того же вопроса должна опираться на тот же критерий.',
        expectedFragments: ['релевантный номер', 'Как правило работает'],
    },
];