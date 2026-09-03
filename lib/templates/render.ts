import nunjucks from 'nunjucks';
import { supabase } from '@/utils/supabase';

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
    now: string;
}

/** Собирает данные заказа для шаблона. Возвращает null, если заказа нет. */
export async function buildOrderContext(orderNumber: string): Promise<OrderTemplateContext | null> {
    const { data: order } = await supabase
        .from('orders')
        .select('order_id, number, raw_payload')
        .eq('order_id', orderNumber)
        .maybeSingle();

    if (!order) return null;

    const payload = (order.raw_payload ?? {}) as Record<string, any>;

    return {
        // Раскладываем raw_payload как есть — это объект заказа RetailCRM.
        order: {
            ...payload,
            number: payload.number ?? order.number ?? order.order_id,
            id: payload.id ?? order.order_id,
        },
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
