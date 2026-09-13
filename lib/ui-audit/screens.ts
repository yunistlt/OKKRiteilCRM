/**
 * Реестр экранов для режима тестировщика и прогона проверок вёрстки.
 *
 * Один экран = маршрут + (необязательно) шаги, которые открывают вложенное
 * состояние (модалку, панель). Список нужен и скрипту `scripts/ui-audit.ts`
 * (Playwright), и странице `/settings/qa` (режим тестировщика в приложении).
 *
 * Держим в синхроне с `app/**\/page.tsx`: тест `tests/ui-audit-screens.test.ts`
 * падает, если появился маршрут без записи здесь.
 */

export type UiAuditStep =
    /** Клик по первому элементу, подходящему под селектор. */
    | { click: string; label: string }
    /** Подождать появления селектора (мс — таймаут). */
    | { waitFor: string; timeout?: number };

export type UiAuditScreen = {
    /** Уникальный ключ (для имён файлов отчёта). */
    key: string;
    /** Человеческое название. */
    title: string;
    /** Раздел (как в сайдбаре). */
    section: string;
    /** Маршрут. Для динамических — с подставленным примером. */
    path: string;
    /** Маршрут-шаблон из app/ (для сверки с файлами). */
    route: string;
    /** Роль, под которой открываем (по умолчанию admin). */
    role?: 'admin' | 'okk' | 'rop' | 'manager';
    /** Шаги после загрузки — открыть модалку/панель. */
    steps?: UiAuditStep[];
    /** Публичный маршрут (без сессии). */
    public?: boolean;
    /** Экран не проверяем (причина — обязательна). */
    skip?: string;
};

export const UI_AUDIT_VIEWPORTS = [
    { key: 'desktop', title: 'Десктоп 1440×900', width: 1440, height: 900 },
    { key: 'laptop', title: 'Ноутбук 1280×720', width: 1280, height: 720 },
    { key: 'narrow', title: 'Узкое окно 1024×700', width: 1024, height: 700 },
    { key: 'mobile', title: 'Телефон 375×812', width: 375, height: 812 },
] as const;

export type UiAuditViewportKey = (typeof UI_AUDIT_VIEWPORTS)[number]['key'];

export const UI_AUDIT_SCREENS: UiAuditScreen[] = [
    // ── Управление ────────────────────────────────────────────────────────
    { key: 'home', title: 'Центр управления', section: 'Управление', path: '/', route: '/' },
    { key: 'shtab', title: 'Штаб', section: 'Управление', path: '/shtab', route: '/shtab' },
    { key: 'orders', title: 'Заказы', section: 'Управление', path: '/orders', route: '/orders' },
    {
        key: 'orders-card',
        title: 'Заказы → карточка заказа',
        section: 'Управление',
        path: '/orders',
        route: '/orders',
        steps: [
            { waitFor: '[data-ui-audit="order-row"]', timeout: 30000 },
            { click: '[data-ui-audit="order-row"]', label: 'первая строка заказа' },
            { waitFor: '[data-ui-audit="order-modal"]', timeout: 30000 },
        ],
    },
    { key: 'statuses-board', title: 'Статусы и переходы', section: 'Управление', path: '/settings/statuses/board', route: '/settings/statuses/board' },
    { key: 'okk', title: 'Контроль качества', section: 'Управление', path: '/okk', route: '/okk' },
    { key: 'okk-audit', title: 'Контроль качества → аудит', section: 'Управление', path: '/okk/audit', route: '/okk/audit' },
    { key: 'okk-criteria', title: 'Контроль качества → критерии', section: 'Управление', path: '/okk/criteria', route: '/okk/criteria' },
    { key: 'agents', title: 'Все ИИ-агенты', section: 'Управление', path: '/agents', route: '/agents' },
    { key: 'agents-katerina', title: 'Агент Катерина (почта)', section: 'Управление', path: '/agents/katerina', route: '/agents/katerina' },
    { key: 'agents-relevance', title: 'Агент актуальности', section: 'Управление', path: '/agents/relevance', route: '/agents/relevance' },
    { key: 'ai-tools', title: 'Согласование отмен', section: 'Управление', path: '/settings/ai-tools', route: '/settings/ai-tools' },
    { key: 'violations', title: 'Нарушения', section: 'Управление', path: '/violations', route: '/violations' },
    { key: 'payments', title: 'Платежи', section: 'Управление', path: '/payments', route: '/payments' },
    { key: 'efficiency', title: 'Эффективность', section: 'Управление', path: '/efficiency', route: '/efficiency' },

    // ── Аналитика ─────────────────────────────────────────────────────────
    { key: 'analytics', title: 'Хаб аналитики', section: 'Аналитика', path: '/analytics', route: '/analytics' },
    { key: 'analytics-quality', title: 'Аналитика → качество', section: 'Аналитика', path: '/analytics/quality', route: '/analytics/quality' },
    { key: 'analytics-violations', title: 'Аналитика → нарушения', section: 'Аналитика', path: '/analytics/violations', route: '/analytics/violations' },
    { key: 'analytics-manager', title: 'Аналитика → менеджер', section: 'Аналитика', path: '/analytics/managers/1', route: '/analytics/managers/[id]' },

    // ── Зарплата ──────────────────────────────────────────────────────────
    { key: 'salary', title: 'Зарплата ОП', section: 'Зарплата', path: '/salary', route: '/salary' },
    { key: 'salary-my', title: 'Моя зарплата', section: 'Зарплата', path: '/salary/my', route: '/salary/my' },
    { key: 'salary-settings', title: 'Настройки мотивации', section: 'Зарплата', path: '/salary/settings', route: '/salary/settings' },

    // ── Связь ─────────────────────────────────────────────────────────────
    { key: 'lead-catcher', title: 'Ловец лидов', section: 'Связь', path: '/okk/lead-catcher', route: '/okk/lead-catcher' },
    { key: 'lead-catcher-analytics', title: 'Ловец лидов → аналитика', section: 'Связь', path: '/lead-catcher/admin/analytics', route: '/lead-catcher/admin/analytics' },
    { key: 'messenger', title: 'Мессенджер', section: 'Связь', path: '/messenger', route: '/messenger' },

    // ── Юридический отдел ─────────────────────────────────────────────────
    { key: 'legal', title: 'Юридический отдел', section: 'Юридический отдел', path: '/legal', route: '/legal' },

    // ── Система ───────────────────────────────────────────────────────────
    { key: 'settings', title: 'Настройки', section: 'Система', path: '/settings', route: '/settings' },
    { key: 'settings-status', title: 'Статус систем', section: 'Система', path: '/settings/status', route: '/settings/status' },
    { key: 'settings-access', title: 'Доступы и права', section: 'Система', path: '/settings/access', route: '/settings/access' },
    { key: 'settings-managers', title: 'Менеджеры', section: 'Система', path: '/settings/managers', route: '/settings/managers' },
    { key: 'settings-statuses', title: 'Статусы заказов', section: 'Система', path: '/settings/statuses', route: '/settings/statuses' },
    { key: 'settings-sales-rop', title: 'Бот-РОП', section: 'Система', path: '/settings/sales-rop', route: '/settings/sales-rop' },
    { key: 'settings-rules', title: 'Правила', section: 'Система', path: '/settings/rules', route: '/settings/rules' },
    { key: 'settings-templates', title: 'Шаблоны документов', section: 'Система', path: '/settings/templates', route: '/settings/templates' },
    { key: 'settings-widget', title: 'Виджет на сайт', section: 'Система', path: '/settings/widget', route: '/settings/widget' },
    { key: 'settings-profile', title: 'Личный профиль', section: 'Система', path: '/settings/profile', route: '/settings/profile' },
    { key: 'settings-qa', title: 'Режим тестировщика', section: 'Система', path: '/settings/qa', route: '/settings/qa' },

    // ── AI Центр ──────────────────────────────────────────────────────────
    { key: 'settings-ai', title: 'Настройка промпта', section: 'AI Центр', path: '/settings/ai', route: '/settings/ai' },
    { key: 'settings-ai-examples', title: 'Примеры обучения', section: 'AI Центр', path: '/settings/ai/training-examples', route: '/settings/ai/training-examples' },
    { key: 'settings-prompts', title: 'Промпты', section: 'AI Центр', path: '/settings/prompts', route: '/settings/prompts' },
    { key: 'settings-ai-costs', title: 'Расходы на ИИ', section: 'AI Центр', path: '/settings/ai-costs', route: '/settings/ai-costs' },

    // ── Публичные ─────────────────────────────────────────────────────────
    { key: 'login', title: 'Вход', section: 'Публичные', path: '/login', route: '/login', public: true },
    { key: 'forgot-password', title: 'Восстановление пароля', section: 'Публичные', path: '/forgot-password', route: '/forgot-password', public: true },
    { key: 'reset-password', title: 'Новый пароль', section: 'Публичные', path: '/reset-password', route: '/reset-password', public: true },
    { key: 'invite', title: 'Приглашение', section: 'Публичные', path: '/invite/test', route: '/invite/[token]', public: true },
    { key: 'lead-proposal', title: 'КП для клиента (ловец лидов)', section: 'Публичные', path: '/lead-catcher/proposal/test', route: '/lead-catcher/proposal/[token]', public: true },
    { key: 'lead-invoice', title: 'Счёт для клиента (ловец лидов)', section: 'Публичные', path: '/lead-catcher/invoice/test', route: '/lead-catcher/invoice/[token]', public: true },

    // ── Служебные (не проверяем) ──────────────────────────────────────────
    { key: 'debug-action', title: 'Отладка действий', section: 'Служебные', path: '/debug-action', route: '/debug-action', skip: 'отладочная страница разработчика' },
    { key: 'debug-db', title: 'Отладка БД', section: 'Служебные', path: '/debug-db', route: '/debug-db', skip: 'отладочная страница разработчика' },
];

export function getUiAuditScreen(key: string): UiAuditScreen | undefined {
    return UI_AUDIT_SCREENS.find((s) => s.key === key);
}
