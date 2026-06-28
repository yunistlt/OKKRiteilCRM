import { ANNA_INSIGHT_PROMPT, DEFAULT_ROUTING_PROMPT } from '@/lib/prompts';
import { DEFAULT_LEGAL_PROMPTS } from '@/lib/legal-consultant-ai';

export type AgentStatus = 'production' | 'foundation' | 'planned';
export type AgentDomain = 'ОКК' | 'Legal' | 'Support' | 'Секретариат';

export type AgentProfile = {
    id: string;
    name: string;
    role: string;
    domain: AgentDomain;
    avatarSrc: string;
    status: AgentStatus;
    summary: string;
    responsibilities: string[];
    connections: string[];
    promptLabel: string;
    promptText: string;
    promptSourceLabel?: string;
    promptSourceHref?: string;
    routes: string[];
};

export const AGENT_STATUS_LABELS: Record<AgentStatus, string> = {
    production: 'В работе',
    foundation: 'Базовый',
    planned: 'В планах',
};

export const AGENT_STATUS_STYLES: Record<AgentStatus, string> = {
    production: 'bg-emerald-100 text-emerald-800 border-emerald-200',
    foundation: 'bg-amber-100 text-amber-900 border-amber-200',
    planned: 'bg-slate-100 text-slate-700 border-slate-200',
};

export const AGENT_DOMAINS: AgentDomain[] = ['ОКК', 'Legal', 'Support', 'Секретариат'];

/** Агенты с детальным экраном по клику на карточку (href = /agents/<id>). */
export const AGENT_DETAIL_IDS = new Set<string>(['katerina']);

function compactPrompt(prompt: string, maxLength: number = 420) {
    const normalized = prompt.replace(/\s+/g, ' ').trim();
    if (normalized.length <= maxLength) return normalized;
    return `${normalized.slice(0, maxLength).trim()}...`;
}

export const AGENT_PROFILES: AgentProfile[] = [
    {
        id: 'katerina',
        name: 'Катерина',
        role: 'Секретарь',
        domain: 'Секретариат',
        avatarSrc: '/images/agents/katerina.svg',
        status: 'production',
        summary: 'Разбирает входящую почту: отделяет новые заявки от переписки и спама, заводит заказ и назначает менеджера.',
        responsibilities: [
            'Читает входящий почтовый ящик и определяет тип каждого письма.',
            'Новая заявка → создаёт заказ и назначает менеджера (по истории клиента или по нагрузке).',
            'Переписку по заказам (Re), роботов (noreply) и рекламу — пропускает.',
        ],
        connections: [
            'Передаёт новые заявки в RetailCRM и закрепляет за клиентским менеджером.',
            'Пул менеджеров и рабочие статусы берёт из настроек (Менеджеры, Статусы Заказов).',
        ],
        promptLabel: 'System Prompt',
        promptText: 'Загружается из ai_prompts (email_secretary_classifier).',
        promptSourceLabel: 'ai_prompts (runtime)',
        promptSourceHref: '/agents/katerina',
        routes: ['/agents/katerina'],
    },
    {
        id: 'anna',
        name: 'Анна',
        role: 'Бизнес-аналитик',
        domain: 'ОКК',
        avatarSrc: '/images/agents/anna.png',
        status: 'production',
        summary: 'Стратегический анализ сделок, поиск ЛПР, противоречий и точек роста в диалогах менеджеров.',
        responsibilities: [
            'Глубокий разбор истории заказа, звонков и комментариев.',
            'Поиск ЛПР, бюджета, сроков и скрытых болей клиента.',
            'Выявление противоречий между словами менеджера и реальным диалогом.',
        ],
        connections: [
            'Передает аналитические инсайты Максиму для маршрутизации и итогового решения.',
            'Получает свежие факты и историю от Семёна.',
        ],
        promptLabel: 'System Prompt',
        promptText: compactPrompt(ANNA_INSIGHT_PROMPT),
        promptSourceLabel: 'lib/prompts.ts',
        promptSourceHref: '/settings/ai-tools',
        routes: ['/','/settings/ai-tools'],
    },
    {
        id: 'maxim',
        name: 'Максим',
        role: 'Аудитор',
        domain: 'ОКК',
        avatarSrc: '/images/agents/maxim.png',
        status: 'production',
        summary: 'Итоговая маршрутизация заказов, сборка выводов от других агентов и контроль качества по rule engine.',
        responsibilities: [
            'Сводит результаты Семёна и Игоря.',
            'Использует rule engine и AI-routing для решения по статусу заказа.',
            'Формирует итоговую оценку качества и нарушения.',
        ],
        connections: [
            'Получает инсайты от Анны, факты от Семёна и SLA-сигналы от Игоря.',
            'Пишет результат во внешние каналы и управляет маршрутами заказа.',
        ],
        promptLabel: 'Routing Prompt',
        promptText: compactPrompt(DEFAULT_ROUTING_PROMPT),
        promptSourceLabel: 'lib/prompts.ts',
        promptSourceHref: '/settings/ai',
        routes: ['/okk','/settings/rules'],
    },
    {
        id: 'igor',
        name: 'Игорь',
        role: 'Диспетчер',
        domain: 'ОКК',
        avatarSrc: '/images/agents/igor.png',
        status: 'production',
        summary: 'Контроль SLA, сроков и критических отклонений без LLM, на чистой логике и алертинге.',
        responsibilities: [
            'Мониторинг просрочек, статусов и следующих контактов.',
            'Сбор алертов и сигналов для руководителей.',
            'Поддержание operational health агентов и систем.',
        ],
        connections: [
            'Использует факты, собранные Семёном.',
            'Отдает SLA-часть Максиму и уведомления в Telegram.',
        ],
        promptLabel: 'Operational Contract',
        promptText: 'Rule-based агент. Не использует LLM: вычисляет SLA, просрочки, время в статусе и критические отклонения по заранее заданной логике.',
        routes: ['/settings/status'],
    },
    {
        id: 'semen',
        name: 'Семён',
        role: 'Архивариус',
        domain: 'ОКК',
        avatarSrc: '/images/agents/semen.png',
        status: 'production',
        summary: 'Синхронизация RetailCRM, сбор истории, звонков и фактов для остальных агентных контуров.',
        responsibilities: [
            'Инкрементальная загрузка заказов, клиентов, звонков и истории.',
            'Матчинг звонков и пополнение фактического контекста заказа.',
            'Подготовка фактов для Анны, Максима и Игоря.',
        ],
        connections: [
            'Является data backbone для ОКК-контура.',
            'Передает факты Анне, Максиму и Игорю.',
        ],
        promptLabel: 'Operational Contract',
        promptText: 'ETL и fact-collection контур. Основная задача — качать любой чих из RetailCRM, синхронизировать историю и подготавливать структурированные данные для остальных агентов.',
        routes: ['/okk','/okk/audit'],
    },
    {
        id: 'elena',
        name: 'Елена',
        role: 'Продуктолог',
        domain: 'Support',
        avatarSrc: '/images/agents/elena.png',
        status: 'production',
        summary: 'Формирует продуктовую базу знаний и проверяет, существует ли товар в ассортименте, чтобы не допускать ложных отмен.',
        responsibilities: [
            'Исследует товары и их технические характеристики.',
            'Актуализирует product_knowledge.',
            'Верифицирует спорные отмены по ассортименту.',
        ],
        connections: [
            'Отдает сигналы Максиму для возврата ложных отмен в работу.',
        ],
        promptLabel: 'Research Prompt',
        promptText: 'Ты ЕЛЕНА — Продуктолог компании. Изучи описание товара и составь технический и маркетинговый паспорт: характеристики, задачи, боли клиента, сценарии применения и классификацию номенклатуры.',
        routes: ['/settings','/settings/ai-tools'],
    },
    {
        id: 'lev',
        name: 'Лев',
        role: 'Главный ИИ-юрисконсульт',
        domain: 'Legal',
        avatarSrc: '/images/agents/lev.svg',
        status: 'foundation',
        summary: 'Отдельный контур contract redlining и юридической экспертизы договоров для юристов и согласующих ролей.',
        responsibilities: [
            'Прием договоров, приложений и допсоглашений на review.',
            'Анализ risk flags, подсудности, штрафов и обязательных разделов.',
            'Подготовка redlining-report и предложений для протокола разногласий.',
        ],
        connections: [
            'Получает эскалации по договорам от Дарьи.',
            'Передает high-risk и manual-review кейсы живому юристу.',
        ],
        promptLabel: 'Target Prompt Contract',
        promptText: 'Ты внутренний legal-redlining агент. Сверяй каждый пункт договора с матрицей рисков компании, выделяй red/yellow flags, проверяй обязательные разделы и предлагай безопасные редакции для протокола разногласий.',
        routes: ['/legal'],
    },
    {
        id: 'boris',
        name: 'Борис',
        role: 'ИИ-специалист Due Diligence',
        domain: 'Legal',
        avatarSrc: '/images/agents/boris.svg',
        status: 'foundation',
        summary: 'Контур автоматической проверки контрагентов, кэширования результатов и выдачи риск-светофора по ИНН.',
        responsibilities: [
            'Проверка контрагентов по внешним реестрам и API.',
            'Нормализация фактов, риск-скоринг и краткое AI-summary.',
            'Автосоздание legal task при красном риске.',
        ],
        connections: [
            'Может запускаться из карточки заказа и из юридического контура.',
            'Передает red-risk кейсы юристам и согласующим ролям.',
        ],
        promptLabel: 'Target Prompt Contract',
        promptText: 'Ты AI-агент due diligence. По ИНН собери данные из внешних источников, выдели признаки банкротства, судебные и исполнительные риски, присвой green/yellow/red и дай краткое, проверяемое summary без выдумок.',
        routes: ['/legal'],
    },
    {
        id: 'darya',
        name: 'Дарья',
        role: 'Legal Helpdesk',
        domain: 'Legal',
        avatarSrc: '/images/agents/darya.svg',
        status: 'foundation',
        summary: 'Первая линия юридических ответов по KB-first модели с жесткой границей знаний и эскалацией к юристу.',
        responsibilities: [
            'Отвечает на типовые вопросы сотрудников по базе знаний.',
            'Не выходит за границы RAG и не выдумывает правовые нормы.',
            'Собирает payload и создает эскалацию юристу при вопросах вне покрытия.',
        ],
        connections: [
            'Передает договорные кейсы Льву.',
            'Может запускать Бориса и Григория как downstream-контуры.',
        ],
        promptLabel: 'Current Prompt Contract',
        promptText: compactPrompt(DEFAULT_LEGAL_PROMPTS.legal_consultant_main_chat.systemPrompt),
        promptSourceLabel: 'ai_prompts / DEFAULT_LEGAL_PROMPTS',
        promptSourceHref: '/legal',
        routes: ['/legal'],
    },
    {
        id: 'grigory',
        name: 'Григорий',
        role: 'Претензионная работа',
        domain: 'Legal',
        avatarSrc: '/images/agents/grigory.svg',
        status: 'planned',
        summary: 'Фоновый агент для подготовки досудебных претензий по просроченной дебиторской задолженности.',
        responsibilities: [
            'Отслеживание триггеров просроченной оплаты.',
            'Сбор данных по долгу, пеням и реквизитам.',
            'Подготовка черновика претензии и передача юристу.',
        ],
        connections: [
            'Может запускаться по команде Дарьи или по системному триггеру.',
            'Передает результат живому юристу для проверки и отправки.',
        ],
        promptLabel: 'Target Prompt Contract',
        promptText: 'Ты AI-агент претензионной работы. По просроченному заказу собери сумму долга, основания, реквизиты и расчет пени, затем подготовь полный черновик досудебной претензии по утвержденному шаблону без самостоятельной отправки клиенту.',
        routes: ['/legal'],
    },
];