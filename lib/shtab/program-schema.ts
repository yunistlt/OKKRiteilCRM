import { TASK_KINDS } from '@/lib/shtab/programs';

// Схемы структурированного вывода: по ним модель обязана вернуть ответ.
//
// Форма гарантируется схемой, а не просьбой в промпте. Причина простая: ответ
// разбирает не человек, а код, и дальше по нему пишется программа в базу.
// Уговорить модель «верни, пожалуйста, JSON» можно, а гарантировать нельзя.
//
// strict: true в OpenAI требует, чтобы у каждого объекта были перечислены ВСЕ
// свойства в required и стояло additionalProperties: false. Поэтому
// необязательные поля объявлены как ['string','null'] — модель обязана прислать
// ключ, но может прислать null.

export const BLOCKS_SCHEMA = {
    name: 'shtab_blocks',
    schema: {
        type: 'object',
        additionalProperties: false,
        required: ['blocks'],
        properties: {
            blocks: {
                type: 'array',
                items: {
                    type: 'object',
                    additionalProperties: false,
                    required: ['ordinal', 'title', 'excerpt', 'rationale'],
                    properties: {
                        ordinal: { type: 'integer', description: 'Порядок блока, начиная с 1' },
                        title: { type: 'string', description: 'Короткое название блока' },
                        excerpt: {
                            type: 'string',
                            description: 'Куски исходного текста стратегии, попавшие в блок. Не пересказ.',
                        },
                        rationale: {
                            type: 'string',
                            description: 'Почему нарезано именно так. Владелец утверждает нарезку и должен видеть довод.',
                        },
                    },
                },
            },
        },
    },
} as const;

export const PROGRAM_SCHEMA = {
    name: 'shtab_program',
    schema: {
        type: 'object',
        additionalProperties: false,
        required: ['mainTask', 'managerName', 'tasks'],
        properties: {
            mainTask: {
                type: 'string',
                description: 'Главная задача — РЕЗУЛЬТАТ, а не действие. Не начинается с инфинитива.',
            },
            managerName: {
                type: 'string',
                description: 'Ровно один руководитель: одна должность или один человек.',
            },
            tasks: {
                type: 'array',
                items: {
                    type: 'object',
                    additionalProperties: false,
                    required: ['kind', 'ordinal', 'text', 'why', 'metric', 'targetValue', 'sourceNote'],
                    properties: {
                        kind: { type: 'string', enum: [...TASK_KINDS] },
                        ordinal: { type: 'integer', description: 'Порядок внутри своего типа, начиная с 1' },
                        text: { type: 'string' },
                        why: {
                            type: ['string', 'null'],
                            description: 'Почему так. У жизненно важных задач обязательно.',
                        },
                        metric: {
                            type: ['string', 'null'],
                            description: 'Что именно меряем. Только у производственных задач.',
                        },
                        targetValue: {
                            type: ['string', 'null'],
                            description:
                                'Целевое значение. Если числа нет — оставь пустым и обязательно заполни sourceNote. Выдумывать число запрещено.',
                        },
                        sourceNote: {
                            type: ['string', 'null'],
                            description: 'Каким замером и на каком шаге программы закрывается пропуск.',
                        },
                    },
                },
            },
        },
    },
} as const;
