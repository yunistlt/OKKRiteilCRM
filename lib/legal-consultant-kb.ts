export type LegalKnowledgeAudience = 'all' | 'supervisor' | 'legal';

export type LegalKnowledgeSeedRow = {
    slug: string;
    type: string;
    sectionKey: string | null;
    title: string;
    content: string;
    tags: string[];
    sourceRef: string;
    metadata?: Record<string, any>;
};

const KB_VERSION = 1;

const LEGAL_KNOWLEDGE_CATALOG = [
    {
        sectionKey: 'returns',
        title: 'Возвраты и претензии',
        rows: [
            {
                slug: 'returns:window',
                type: 'policy',
                title: 'Окно первичной проверки возврата',
                content: [
                    'Если клиент заявляет о возврате или претензии, менеджер обязан зафиксировать причину обращения, дату отгрузки, фото/документы и номер заказа.',
                    'До передачи юристу нельзя обещать возврат денег, штраф, мировое соглашение или изменение договора.',
                    'Если в обращении есть риск суда, жалоба в контролирующие органы или требование о крупных санкциях, нужна ручная эскалация юристу.',
                ].join('\n'),
                tags: ['возврат', 'претензия', 'жалоба', 'срок', 'эскалация'],
                audience: 'all' as LegalKnowledgeAudience,
            },
            {
                slug: 'returns:evidence',
                type: 'checklist',
                title: 'Что собрать по возврату до эскалации',
                content: [
                    'Минимальный пакет: номер заказа, контрагент, дата поставки, описание дефекта, фото/видео, переписка с клиентом, позиция менеджера.',
                    'Если есть договор или спецификация, приложить редакцию, по которой шла отгрузка.',
                    'Если вопрос касается некачественного товара, нужно зафиксировать, использовался ли товар и есть ли акт/накладная.',
                ].join('\n'),
                tags: ['документы', 'фото', 'доказательства', 'возврат'],
                audience: 'all' as LegalKnowledgeAudience,
            },
        ],
    },
    {
        sectionKey: 'nda',
        title: 'NDA и конфиденциальность',
        rows: [
            {
                slug: 'nda:sharing',
                type: 'policy',
                title: 'Передача NDA и чувствительных материалов',
                content: [
                    'Менеджер может отправлять только утвержденный шаблон NDA и публичные сопроводительные материалы.',
                    'Нельзя пересылать внутренние приложения, служебные комментарии, историю правок и несогласованные формулировки.',
                    'Если клиент просит изменить штрафы, подсудность, исключения по конфиденциальности или срок действия NDA, вопрос передается юристу.',
                ].join('\n'),
                tags: ['nda', 'конфиденциальность', 'шаблон', 'редлайн'],
                audience: 'all' as LegalKnowledgeAudience,
            },
            {
                slug: 'nda:redflags',
                type: 'red_flags',
                title: 'Красные флаги в NDA',
                content: [
                    'Ручная эскалация обязательна, если клиент требует односторонний NDA, бессрочную ответственность, иностранную подсудность или передачу всех споров в арбитраж вне стандартного шаблона.',
                    'Также эскалация нужна, если в NDA упоминаются персональные данные, коммерческая тайна третьих лиц или обязанность уничтожать документы в нестандартном порядке.',
                ].join('\n'),
                tags: ['nda', 'подсудность', 'ответственность', 'персональные данные'],
                audience: 'all' as LegalKnowledgeAudience,
            },
        ],
    },
    {
        sectionKey: 'counterparty',
        title: 'Проверка контрагентов',
        rows: [
            {
                slug: 'counterparty:triage',
                type: 'checklist',
                title: 'Базовый triage по контрагенту',
                content: [
                    'Перед эскалацией собираются: ИНН, наименование, источник обращения, связанный заказ, краткий бизнес-контекст и причина сомнений.',
                    'Красный уровень риска означает, что менеджер не должен обещать отгрузку или подписание до ручного подтверждения.',
                    'Желтый уровень требует уточнения документов и фиксации риска в комментарии к заказу.',
                ].join('\n'),
                tags: ['инн', 'контрагент', 'проверка', 'риск'],
                audience: 'all' as LegalKnowledgeAudience,
            },
            {
                slug: 'counterparty:internal-thresholds',
                type: 'internal_policy',
                title: 'Внутренние лимиты согласования высокого риска',
                content: [
                    'Если по контрагенту выявлены красные флаги, решение о продолжении допускается только после ручного согласования юридической функции и ответственного руководителя.',
                    'Внутренние лимиты и сценарии согласования не раскрываются менеджерам в полном объеме через чат; система должна советовать эскалацию без публикации служебных правил.',
                ].join('\n'),
                tags: ['лимиты', 'согласование', 'высокий риск'],
                audience: 'legal' as LegalKnowledgeAudience,
            },
        ],
    },
    {
        sectionKey: 'contracts',
        title: 'Договоры и согласование условий',
        rows: [
            {
                slug: 'contracts:manager-scope',
                type: 'policy',
                title: 'Что менеджер может согласовать без юриста',
                content: [
                    'Менеджер может использовать только утвержденный шаблон и заполнять коммерческие поля, если юридические условия не меняются.',
                    'Любые изменения штрафов, ограничений ответственности, подсудности, порядка приемки, интеллектуальных прав или персональных данных требуют эскалации юристу.',
                ].join('\n'),
                tags: ['договор', 'шаблон', 'согласование', 'штраф'],
                audience: 'all' as LegalKnowledgeAudience,
            },
            {
                slug: 'contracts:redlines',
                type: 'checklist',
                title: 'Чеклист redlines для передачи юристу',
                content: [
                    'Перед эскалацией нужно приложить исходный файл, выделить спорные пункты, описать деловую цель изменения и указать дедлайн по сделке.',
                    'Если клиент прислал свою редакцию, менеджер не должен самостоятельно подтверждать приемлемость формулировок.',
                ].join('\n'),
                tags: ['redline', 'дедлайн', 'протокол разногласий'],
                audience: 'all' as LegalKnowledgeAudience,
            },
        ],
    },
    {
        sectionKey: 'escalation',
        title: 'Эскалация юристу',
        rows: [
            {
                slug: 'escalation:when',
                type: 'policy',
                title: 'Когда чат обязан отправлять к юристу',
                content: [
                    'Эскалация обязательна, если вопрос касается судебных споров, претензий с денежными санкциями, нестандартных договорных условий, персональных данных, комплаенс-рисков или вопрос выходит за рамки базы знаний.',
                    'Если знаний недостаточно, агент должен прямо сказать, что не знает, и предложить создать задачу юристу.',
                ].join('\n'),
                tags: ['эскалация', 'юрист', 'fallback', 'не знаю'],
                audience: 'all' as LegalKnowledgeAudience,
            },
            {
                slug: 'escalation:payload',
                type: 'checklist',
                title: 'Что входит в задачу для юриста',
                content: [
                    'Обязательные поля: тема, номер заказа или контрагент, краткий вопрос, риск для сделки, крайний срок ответа, приложенные документы.',
                    'Желательно приложить последнюю формулировку клиента и позицию менеджера по желаемому результату.',
                ].join('\n'),
                tags: ['задача', 'бриф', 'эскалация', 'дедлайн'],
                audience: 'all' as LegalKnowledgeAudience,
            },
        ],
    },
] as const;

export function getLegalKnowledgeVersion() {
    return KB_VERSION;
}

export function getLegalKnowledgeSections() {
    return LEGAL_KNOWLEDGE_CATALOG.map((section) => ({
        key: section.sectionKey,
        title: section.title,
        itemCount: section.rows.length,
    }));
}

export function buildLegalKnowledgeSeedRows(): LegalKnowledgeSeedRow[] {
    return LEGAL_KNOWLEDGE_CATALOG.flatMap((section) => section.rows.map((row) => ({
        slug: row.slug,
        type: row.type,
        sectionKey: section.sectionKey,
        title: row.title,
        content: row.content,
        tags: row.tags,
        sourceRef: `${section.sectionKey}:${row.slug}`,
        metadata: {
            audience: row.audience,
            version: KB_VERSION,
            sectionTitle: section.title,
        },
    })));
}