/**
 * Лента событий заказа человеческим языком.
 *
 * Отдельная таблица не нужна: история уже полная — `order_history_log` хранит
 * 682 тысячи изменений, включая свои поля заказа (их RetailCRM присылает с
 * приставкой `custom_`). Не хватало только перевода: в базе лежит
 * `custom_data_kontakta` и код `calc_rate`, а человеку и модели нужно
 * «Дата следующего контакта» и «Смета».
 */
import { supabase } from '@/utils/supabase';
import { entityName, fieldName, fieldValue } from './field-names';

/** Подписи стандартных полей заказа: в справочнике RetailCRM их нет, они зашиты в её интерфейсе. */
const STANDARD_LABELS: Record<string, string> = {
    status: 'Статус',
    manager: 'Менеджер',
    manager_comment: 'Комментарий менеджера',
    customer_comment: 'Комментарий клиента',
    order_product: 'Состав заказа',
    'order_product.summ': 'Сумма позиции',
    'order_product.quantity': 'Количество',
    'payments.amount': 'Оплата',
    'payments.status': 'Статус оплаты',
    discount_manual_percent: 'Скидка, %',
    discount_manual_amount: 'Скидка, рублей',
    delivery_address: 'Адрес доставки',
    delivery_cost: 'Стоимость доставки',
    prepay_sum: 'Предоплата',
    shipment_date: 'Дата отгрузки',
    number: 'Номер заказа',
    site: 'Магазин',
};

export type OrderEvent = {
    at: string;
    /** Что изменилось, по-русски. */
    label: string;
    /** Было, по-русски. Пусто — значит поле заполнили впервые. */
    from: string | null;
    /** Стало, по-русски. */
    to: string | null;
    /** Кто изменил, если RetailCRM сказала. */
    who: string | null;
    /** Технический код поля — на случай, если нужен разбор. */
    field: string;
};

function plain(value: unknown): string | null {
    if (value === null || value === undefined || value === '') {
        return null;
    }

    // RetailCRM кладёт в историю то строку, то объект вида {code, name}.
    if (typeof value === 'string') {
        try {
            const parsed = JSON.parse(value);
            if (parsed && typeof parsed === 'object') {
                return parsed.name || parsed.code || null;
            }
        } catch {
            return value;
        }
        return value;
    }

    if (typeof value === 'object') {
        const obj = value as any;
        return obj.name || obj.code || null;
    }

    return String(value);
}

async function humanize(field: string, value: unknown): Promise<string | null> {
    const raw = plain(value);
    if (raw === null) {
        return null;
    }

    if (field.startsWith('custom_')) {
        const code = field.slice('custom_'.length);
        return (await fieldValue(code, raw)) ?? raw;
    }

    // Статус RetailCRM кладёт в историю кодом.
    if (field === 'status') {
        return (await entityName('status', raw)) ?? raw;
    }

    return raw;
}

async function labelFor(field: string): Promise<string> {
    if (field.startsWith('custom_')) {
        return fieldName(field.slice('custom_'.length));
    }

    return STANDARD_LABELS[field] || field;
}

/**
 * Кто изменил. RetailCRM кладёт в историю только номер сотрудника
 * (`{"id": 249}`), поэтому имя достаём из справочника менеджеров.
 */
async function managerNames(ids: number[]): Promise<Map<number, string>> {
    const names = new Map<number, string>();
    if (!ids.length) {
        return names;
    }

    const { data } = await supabase
        .from('managers')
        .select('id, first_name, last_name')
        .in('id', ids);

    for (const row of (data || []) as any[]) {
        const name = [row.last_name, row.first_name].filter(Boolean).join(' ').trim();
        if (name) {
            names.set(Number(row.id), name);
        }
    }

    return names;
}

function whoId(userData: any): number | null {
    const id = Number(userData?.id);
    return Number.isFinite(id) && id > 0 ? id : null;
}

/** Последние события заказа, свежие сверху. */
export async function orderEvents(crmOrderId: number, limit = 50): Promise<OrderEvent[]> {
    const { data, error } = await supabase
        .from('order_history_log')
        .select('field, old_value, new_value, user_data, occurred_at')
        .eq('retailcrm_order_id', crmOrderId)
        .order('occurred_at', { ascending: false })
        .limit(limit);

    if (error) {
        throw error;
    }

    const rows = (data || []) as any[];
    const names = await managerNames(
        Array.from(new Set(rows.map((row) => whoId(row.user_data)).filter((id): id is number => id !== null)))
    );

    const events: OrderEvent[] = [];
    for (const row of rows) {
        const id = whoId(row.user_data);
        events.push({
            at: row.occurred_at,
            label: await labelFor(row.field),
            from: await humanize(row.field, row.old_value),
            to: await humanize(row.field, row.new_value),
            who: id !== null ? (names.get(id) ?? null) : null,
            field: row.field,
        });
    }

    return events;
}

/** Лента строками: «29.09 14:20 — Статус: Новый → В работе (Иванов)». */
export function eventsToText(events: OrderEvent[]): string[] {
    return events.map((e) => {
        const when = new Date(e.at).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
        const change = e.from ? `${e.from} → ${e.to ?? '—'}` : (e.to ?? '—');
        return `${when} — ${e.label}: ${change}${e.who ? ` (${e.who})` : ''}`;
    });
}
