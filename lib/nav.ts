/**
 * Меню приложения — один источник названий разделов.
 *
 * Отсюда их берут и боковое меню, и шапка: раньше шапка держала свой
 * хардкод-список и на незнакомых страницах писала «Центр Управления»
 * (на «Заказах», «Клиентах» и всех новых экранах). Название подраздела
 * человек видит в одном виде везде.
 */
import type { AppRole } from '@/lib/auth';
import { type RouteRule } from '@/lib/rbac';

export interface NavItem {
    name: string;
    href: string;
    icon: string;
    agent?: string;
    allowed?: AppRole[];
}

export interface NavGroup {
    title: string;
    items: NavItem[];
}

export const NAV_GROUPS: NavGroup[] = [
        {
            title: 'Управление',
            items: [
                { name: 'Центр Управления', href: '/', icon: '🏠', allowed: ['admin', 'okk', 'rop'] },
                { name: 'Штаб', href: '/shtab', icon: '🧭', allowed: ['admin'] },
                { name: 'Все ИИ-агенты', href: '/agents', icon: '🧠', allowed: ['admin', 'okk', 'rop', 'manager'] },
                { name: 'Согласование Отмен', href: '/settings/ai-tools', icon: '🤖', agent: 'anna', allowed: ['admin', 'okk'] },
            ]
        },
        {
            // Своя CRM — отдельный раздел меню: заказы, клиенты и аналитика по ним
            // лежат вместе, как в любой CRM (решение владельца 01.10.2026).
            title: 'CRM',
            items: [
                { name: 'Мой день', href: '/analytics', icon: '🎯', allowed: ['admin', 'okk', 'rop', 'manager'] },
                { name: 'Заказы', href: '/orders', icon: '🧾', allowed: ['admin', 'okk', 'rop', 'manager'] },
                { name: 'Клиенты', href: '/clients', icon: '🏢', allowed: ['admin', 'okk', 'rop', 'manager'] },
                { name: 'Письма', href: '/emails', icon: '✉️', allowed: ['admin', 'okk', 'rop', 'manager'] },
                { name: 'Звонки', href: '/calls', icon: '📞', allowed: ['admin', 'okk', 'rop', 'manager'] },
                // Оповещения рядом с письмами и звонками: это тот же поток
                // событий по заказам (решение владельца 05.10.2026).
                { name: 'Оповещения', href: '/notifications', icon: '🔔', allowed: ['admin', 'okk', 'rop', 'manager'] },
                { name: 'Статусы и переходы', href: '/settings/statuses/board', icon: '🔀', allowed: ['admin'] },
                { name: 'Контроль Качества', href: '/okk', icon: '📋', agent: 'maxim' },
            ]
        },
        {
            title: 'Зарплата',
            items: [
                { name: 'Зарплата ОП', href: '/salary', icon: '💰', allowed: ['admin', 'rop'] },
                { name: 'Моя зарплата', href: '/salary/my', icon: '🧾', allowed: ['admin', 'rop', 'manager'] },
                { name: 'Настройки мотивации', href: '/salary/settings', icon: '⚙️', allowed: ['admin', 'rop'] },
            ]
        },
        {
            title: 'Связь',
            items: [
                { name: 'Ловец Лидов', href: '/okk/lead-catcher', icon: '🎯', agent: 'elena' },
                { name: 'Мессенджер', href: '/messenger', icon: '💬' },
            ]
        },
        {
            title: 'Юридический отдел',
            items: [
                { name: 'Документы на согласовании', href: '/legal/approvals', icon: '📝', allowed: ['admin', 'jurist'] },
                { name: 'Претензионно-исковая работа', href: '/legal/matters', icon: '⚖️', allowed: ['admin', 'jurist'] },
                { name: 'Юридический отдел', href: '/legal', icon: '📑', allowed: ['admin', 'okk', 'rop', 'manager', 'jurist'] },
            ]
        },
        {
            title: 'Система',
            items: [
                { name: 'Статус Систем', href: '/settings/status', icon: '🛰️', agent: 'igor', allowed: ['admin'] },
                { name: 'Доступы и права', href: '/settings/access', icon: '🛡️', allowed: ['admin'] },
                { name: 'Менеджеры', href: '/settings/managers', icon: '👤', allowed: ['admin'] },
                { name: 'Наши юрлица', href: '/settings/legal-entities', icon: '🏛️', allowed: ['admin', 'rop'] },
                { name: 'Статусы Заказов', href: '/settings/statuses', icon: '📂', allowed: ['admin'] },
                { name: 'Бот-РОП', href: '/settings/sales-rop', icon: '📋', allowed: ['admin', 'rop'] },
                { name: 'Уведомления', href: '/settings/notifications', icon: '🔔', allowed: ['admin'] },
                { name: 'Правила (Rules)', href: '/settings/rules', icon: '⚖️', allowed: ['admin'] },
                { name: 'Режим тестировщика', href: '/settings/qa', icon: '🧪', allowed: ['admin'] },
            ]
        },
        {
            title: 'AI Центр',
            items: [
                { name: 'Настройка Промпта', href: '/settings/ai', icon: '✍️', allowed: ['admin'] },
                { name: 'Примеры обучения', href: '/settings/ai/training-examples', icon: '📚', allowed: ['admin'] },
            ]
        }
    ]

/** Название страницы для шапки и заголовка окна: самый длинный подходящий путь. */
export function resolvePageTitle(pathname: string, rules?: RouteRule[]): string {
    const path = (pathname || '/').split('?')[0];

    const matches = (prefix: string) =>
        prefix === '/' ? path === '/' : path === prefix || path.startsWith(`${prefix}/`);

    // Кандидаты из меню и из справочника маршрутов вместе: у вложенного экрана
    // (`/orders/new`) своё название точнее, чем у раздела (`/orders`).
    const candidates = [
        ...NAV_GROUPS.flatMap((group) => group.items).map((item) => ({
            title: item.name,
            prefix: item.href.split('?')[0],
            fromMenu: true,
        })),
        ...(rules || [])
            .filter((rule) => !rule.prefix.startsWith('/api'))
            .map((rule) => ({ title: rule.label, prefix: rule.prefix, fromMenu: false })),
    ].filter((candidate) => matches(candidate.prefix));

    const best = candidates.sort(
        (left, right) =>
            right.prefix.length - left.prefix.length ||
            Number(right.fromMenu) - Number(left.fromMenu),
    )[0];

    return best?.title || 'Центр Управления';
}
