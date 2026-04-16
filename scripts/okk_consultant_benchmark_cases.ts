export type BenchmarkCase = {
    id: string;
    category: 'reference' | 'proof' | 'missing' | 'ambiguous' | 'historical' | 'paraphrase' | 'ui';
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