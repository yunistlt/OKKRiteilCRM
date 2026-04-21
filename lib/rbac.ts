import type { AppSession, AppRole } from '@/lib/auth';

export const APP_ROLES: AppRole[] = ['admin', 'okk', 'rop', 'manager'];

export type RouteRule = {
    prefix: string;
    label: string;
    description: string;
    category: string;
    allowed: AppRole[];
};

export const DEFAULT_ROUTE_RULES: RouteRule[] = [
    { prefix: '/agents', label: 'Каталог ИИ-агентов', description: 'Справочная страница со всеми агентами, их ролями, связями и prompt contract.', category: 'Управление', allowed: ['admin', 'okk', 'rop', 'manager'] },
    { prefix: '/settings/ai/training-examples', label: 'Примеры обучения', description: 'Управление обучающими примерами и датасетом.', category: 'Система', allowed: ['admin'] },
    { prefix: '/api/settings/training-examples', label: 'API примеров обучения', description: 'Серверные операции для примеров обучения.', category: 'Система', allowed: ['admin'] },
    { prefix: '/settings/access', label: 'Доступы и права', description: 'Управление ролями и матрицей доступа.', category: 'Система', allowed: ['admin'] },
    { prefix: '/api/settings/access', label: 'API доступов и прав', description: 'Серверные операции страницы управления доступом.', category: 'Система', allowed: ['admin'] },
    { prefix: '/settings/managers', label: 'Менеджеры', description: 'Настройка справочника менеджеров RetailCRM.', category: 'Система', allowed: ['admin'] },
    { prefix: '/api/managers', label: 'API менеджеров', description: 'Серверные методы списка и управления менеджерами.', category: 'Система', allowed: ['admin'] },
    { prefix: '/api/sync/managers', label: 'API синхронизации менеджеров', description: 'Синхронизация менеджеров с внешними источниками.', category: 'Система', allowed: ['admin'] },
    { prefix: '/settings/statuses', label: 'Статусы заказов', description: 'Настройка словаря статусов заказов.', category: 'Система', allowed: ['admin'] },
    { prefix: '/api/statuses', label: 'API статусов заказов', description: 'CRUD-операции по статусам заказов.', category: 'Система', allowed: ['admin'] },
    { prefix: '/api/dict/statuses', label: 'API словаря статусов', description: 'Служебные методы словаря статусов.', category: 'Система', allowed: ['admin'] },
    { prefix: '/settings/status', label: 'Статус систем', description: 'Мониторинг сервисов и интеграций.', category: 'Система', allowed: ['admin'] },
    { prefix: '/api/settings/system-status', label: 'API статуса систем', description: 'Серверные методы экрана статуса систем.', category: 'Система', allowed: ['admin'] },
    { prefix: '/settings/rules', label: 'Правила', description: 'Управление правилами и проверками.', category: 'Система', allowed: ['admin'] },
    { prefix: '/api/rules', label: 'API правил', description: 'Серверные методы управления правилами.', category: 'Система', allowed: ['admin'] },
    { prefix: '/settings/ai-tools', label: 'Согласование отмен', description: 'Рабочий экран AI-инструмента согласования.', category: 'Система', allowed: ['admin', 'okk'] },
    { prefix: '/settings/ai', label: 'Настройка промпта', description: 'Управление промптами и AI-настройками.', category: 'Система', allowed: ['admin'] },
    { prefix: '/settings/prompts', label: 'Промпты', description: 'Редактор системных промптов.', category: 'Система', allowed: ['admin'] },
    { prefix: '/api/settings/prompts', label: 'API промптов', description: 'Серверные методы управления промптами.', category: 'Система', allowed: ['admin'] },
    { prefix: '/settings/profile', label: 'Личный профиль', description: 'Профиль пользователя и смена пароля.', category: 'Система', allowed: ['admin', 'okk', 'rop', 'manager'] },
    { prefix: '/settings', label: 'Раздел настроек', description: 'Общий административный раздел.', category: 'Система', allowed: ['admin'] },
    { prefix: '/api/settings', label: 'API настроек', description: 'Серверные маршруты административных настроек.', category: 'Система', allowed: ['admin'] },
    { prefix: '/admin/reactivation', label: 'Админка реактивации', description: 'Управление реактивационными кампаниями.', category: 'Реактивация', allowed: ['admin', 'rop'] },
    { prefix: '/api/reactivation', label: 'API реактивации', description: 'Серверные методы реактивации.', category: 'Реактивация', allowed: ['admin', 'rop'] },
    { prefix: '/reactivation', label: 'Экран реактивации', description: 'Рабочий интерфейс реактивации.', category: 'Реактивация', allowed: ['admin', 'rop'] },
    { prefix: '/api/okk/consultant/logs', label: 'Логи консультанта ОКК', description: 'Аудит и trace-логи консультанта.', category: 'ОКК', allowed: ['admin', 'okk', 'rop'] },
    { prefix: '/okk/audit', label: 'Аудит ОКК', description: 'Экран разбора ответов консультанта.', category: 'ОКК', allowed: ['admin', 'okk', 'rop'] },
    { prefix: '/okk', label: 'Контроль качества', description: 'Основной экран ОКК и оценки заказов.', category: 'ОКК', allowed: ['admin', 'okk', 'rop', 'manager'] },
    { prefix: '/api/okk', label: 'API ОКК', description: 'Серверные методы экрана контроля качества.', category: 'ОКК', allowed: ['admin', 'okk', 'rop', 'manager'] },
    { prefix: '/analytics', label: 'Аналитика', description: 'Раздел аналитики и сводных показателей.', category: 'Аналитика', allowed: ['admin', 'okk', 'rop'] },
    { prefix: '/api/analysis', label: 'API аналитики', description: 'Серверные маршруты аналитики.', category: 'Аналитика', allowed: ['admin', 'okk', 'rop'] },
    { prefix: '/legal', label: 'Юридический отдел', description: 'Дашборд юридического модуля и contract review.', category: 'Юридический отдел', allowed: ['admin', 'okk', 'rop', 'manager'] },
    { prefix: '/api/legal', label: 'API юридического модуля', description: 'Серверные методы legal helpdesk и contract review.', category: 'Юридический отдел', allowed: ['admin', 'okk', 'rop', 'manager'] },
    { prefix: '/messenger', label: 'Мессенджер', description: 'Рабочий раздел внутренних диалогов.', category: 'Связь', allowed: ['admin', 'okk', 'rop', 'manager'] },
    { prefix: '/api/messenger', label: 'API мессенджера', description: 'Серверные методы мессенджера.', category: 'Связь', allowed: ['admin', 'okk', 'rop', 'manager'] },
    { prefix: '/', label: 'Центр управления', description: 'Главная страница и дашборд офиса.', category: 'Управление', allowed: ['admin', 'okk', 'rop'] },
    { prefix: '/admin', label: 'Раздел admin', description: 'Прочие административные страницы.', category: 'Система', allowed: ['admin'] },
];

export function normalizeAllowedRoles(input: unknown): AppRole[] {
    if (!Array.isArray(input)) return ['admin'];
    const unique = Array.from(new Set(input.filter((item): item is AppRole => isAppRole(item))));
    return unique.length > 0 ? unique : ['admin'];
}

export function isAppRole(value: unknown): value is AppRole {
    return typeof value === 'string' && APP_ROLES.includes(value as AppRole);
}

export function hasRole(role: AppRole | null | undefined, allowed: AppRole[]): boolean {
    return Boolean(role && allowed.includes(role));
}

export function hasAnyRole(session: AppSession | null | undefined, allowed: AppRole[]): boolean {
    return hasRole(session?.user?.role, allowed);
}

export function getDefaultPathForRole(role: AppRole | null | undefined): string {
    if (role === 'manager') return '/okk';
    if (role === 'rop') return '/reactivation';
    if (role === 'okk') return '/okk';
    return '/';
}

export function getAllowedRolesForPathFromRules(pathname: string, rules: RouteRule[]): AppRole[] | null {
    const matchedRule = rules
        .filter((rule) => pathname === rule.prefix || pathname.startsWith(`${rule.prefix}/`))
        .sort((left, right) => right.prefix.length - left.prefix.length)[0];

    return matchedRule?.allowed || null;
}

export function getAllowedRolesForPath(pathname: string): AppRole[] | null {
    return getAllowedRolesForPathFromRules(pathname, DEFAULT_ROUTE_RULES);
}

export function canAccessPathWithRules(role: AppRole | null | undefined, pathname: string, rules: RouteRule[]): boolean {
    const allowed = getAllowedRolesForPathFromRules(pathname, rules);
    if (!allowed) return true;
    return hasRole(role, allowed);
}

export function canAccessPath(role: AppRole | null | undefined, pathname: string): boolean {
    return canAccessPathWithRules(role, pathname, DEFAULT_ROUTE_RULES);
}

export function isManager(role: AppRole | null | undefined): boolean {
    return role === 'manager';
}