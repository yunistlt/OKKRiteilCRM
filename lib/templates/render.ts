import nunjucks from 'nunjucks';
import { supabase } from '@/utils/supabase';
import { buildGreeting } from '@/lib/templates/greeting';

/**
 * Отрисовка шаблонов документов и писем.
 *
 * В RetailCRM шаблоны написаны на Twig. Twig — это PHP, поэтому у нас Nunjucks: синтаксис
 * тот же (`{{ }}`, `{% for %}`, фильтры), так что шаблоны переносятся почти без правок.
 *
 * Контекст строится вокруг `order` — это `orders.raw_payload`, то есть ТОТ ЖЕ объект заказа
 * RetailCRM, который подставляют в шаблоны они. Поэтому `{{ order.number }}`,
 * `{{ order.customer.name }}`, цикл по `order.items` работают как в их справочнике объектов.
 */

const env = new nunjucks.Environment(null, { autoescape: true, throwOnUndefined: false });

// Фильтры, без которых не обходится ни один счёт.
env.addFilter('money', (value: unknown) => {
    const n = Number(value);
    if (!Number.isFinite(n)) return '';
    return n.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
});

env.addFilter('number_format', (value: unknown, digits = 2) => {
    const n = Number(value);
    if (!Number.isFinite(n)) return '';
    return n.toLocaleString('ru-RU', { minimumFractionDigits: digits, maximumFractionDigits: digits });
});

env.addFilter('date', (value: unknown, format = 'd.m.Y') => {
    if (!value) return '';
    const d = new Date(String(value));
    if (Number.isNaN(d.getTime())) return String(value);
    const pad = (n: number) => String(n).padStart(2, '0');
    // Поддерживаем формат Twig — так шаблоны из RetailCRM переносятся без правок.
    return format
        .replace(/d/g, pad(d.getDate()))
        .replace(/m/g, pad(d.getMonth() + 1))
        .replace(/Y/g, String(d.getFullYear()))
        .replace(/H/g, pad(d.getHours()))
        .replace(/i/g, pad(d.getMinutes()));
});

export interface OrderTemplateContext {
    order: Record<string, any>;
    company: { name: string; email: string | null };
    /** Готовое обращение по имени и отчеству — `{{ greeting }}` в шаблоне. */
    greeting: string;
    now: string;
}

/** Собирает данные заказа для шаблона. Возвращает null, если заказа нет. */
export async function buildOrderContext(orderNumber: string): Promise<OrderTemplateContext | null> {
    /**
     * Ключом приходит и номер заказа, и его идентификатор. У своих заказов номер
     * с кириллической «А» («1020А») — сравнивать его с числовой колонкой нельзя,
     * база откажется, и шаблон «не собирался» (Ирина 02.10.2026).
     */
    const key = decodeURIComponent(String(orderNumber ?? '')).trim();
    const numeric = /^\d+$/.test(key);

    /**
     * Рабочие значения берём из полей заказа, снимок остаётся подложкой для
     * вложенного — состава и структур, которым отдельных полей нет (закон
     * владельца 06.10.2026: у каждого значения своё поле, снимок — запись
     * истории). Иначе письмо клиенту уходит с устаревшими данными: снимок
     * обновлял перенос из RetailCRM, его отключили.
     */
    const fields = `order_id, number, raw_payload, "firstName", "lastName", patronymic, phone, email,
                    totalsumm, "managerComment", "customerComment", "createdAt", site`;
    /**
     * Ищем сначала по НОМЕРУ, а по идентификатору — только если по номеру не
     * нашлось. У своих заказов это разные числа: номер 900072, идентификатор
     * 900000072, и поиск только по идентификатору не находил их вовсе —
     * шаблон письма по своему заказу молча не собирался (найдено 08.10.2026
     * при проверке обращения по имени и отчеству).
     */
    const byNumber = await supabase.from('orders').select(fields).eq('number', key).maybeSingle();
    const order = byNumber.data
        ?? (numeric
            ? (await supabase.from('orders').select(fields).eq('order_id', key).maybeSingle()).data
            : null);

    if (!order) return null;

    const row = order as any;
    const payload = (row.raw_payload ?? {}) as Record<string, any>;

    return {
        order: {
            ...payload,
            number: row.number ?? payload.number ?? row.order_id,
            id: row.order_id ?? payload.id,
            firstName: row.firstName ?? payload.firstName,
            lastName: row.lastName ?? payload.lastName,
            patronymic: row.patronymic ?? payload.patronymic,
            phone: row.phone ?? payload.phone,
            email: row.email ?? payload.email,
            totalSumm: row.totalsumm ?? payload.totalSumm,
            managerComment: row.managerComment ?? payload.managerComment,
            customerComment: row.customerComment ?? payload.customerComment,
            createdAt: row.createdAt ?? payload.createdAt,
            site: row.site ?? payload.site,
        },
        /**
         * Готовое обращение для шаблона: `{{ greeting }}`. Собирается кодом, а
         * не шаблоном, чтобы «Добрый день, Артём Иванович» выглядело одинаково
         * во всех письмах и не ломалось, когда отчества нет.
         */
        greeting: buildGreeting({
            firstName: row.firstName ?? payload.firstName,
            patronymic: row.patronymic ?? payload.patronymic,
        }),
        company: { name: 'ЗМК', email: process.env.SMTP_USER || null },
        now: new Date().toISOString(),
    };
}

export interface RenderResult {
    ok: boolean;
    output?: string;
    error?: string;
}

/** Отрисовывает шаблон. Ошибку шаблона не роняем наружу — показываем её автору. */
export function renderTemplate(body: string, context: OrderTemplateContext): RenderResult {
    try {
        return { ok: true, output: env.renderString(body, context as any) };
    } catch (e: any) {
        return { ok: false, error: e?.message || 'Ошибка в шаблоне' };
    }
}
