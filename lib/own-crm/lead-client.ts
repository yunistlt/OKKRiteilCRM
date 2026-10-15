/**
 * Подсказка менеджеру по карточке клиента новой заявки.
 *
 * Сама карточка находится или заводится при записи заказа
 * (`insertOwnOrder` → `findOrCreateOwnClient`): по ИНН, затем по названию с
 * почтой или телефоном. Здесь только подсказка на случай, когда по основному
 * ключу карточка не нашлась, а по контакту — похоже, есть.
 *
 * Бот НЕ привязывается к такой карточке сам: совпадение по почте или телефону
 * слишком часто ложное — общий ящик посредника, личный номер снабженца,
 * работающего на несколько фирм. Решает человек.
 *
 * Слов «дубль»/«дубл» в тексте быть не должно: комментарий заказа разбирается
 * фильтром тендерных дублей (`(?:дубль|дубл|dubl)\D*(\d{3,6})`), и заказ
 * вылетел бы из премии.
 *
 * До 15.10.2026 подсказка строилась запросом в RetailCRM
 * (`customers-corporate`). Теперь клиенты ведутся у нас, и смотрим свою базу.
 */
import { supabase } from '@/utils/supabase';

function clean(value: string | null | undefined): string {
    return String(value ?? '').trim();
}

/** Цифры номера: в базе телефоны лежат в разном виде, сравниваем по цифрам. */
function digits(value: string): string {
    return value.replace(/\D/g, '');
}

type ClientRow = { id: number; company_name: string | null; legalName: string | null };

async function byEmail(email: string): Promise<ClientRow[]> {
    const { data } = await supabase
        .from('clients')
        .select('id, company_name, legalName')
        .or(`email.eq.${email},contact_email.eq.${email}`)
        .eq('is_corporate', true)
        .limit(5);
    return (data ?? []) as ClientRow[];
}

async function byPhone(phone: string): Promise<ClientRow[]> {
    const tail = digits(phone).slice(-10);
    if (tail.length < 10) return [];
    const { data } = await supabase
        .from('clients')
        .select('id, company_name, legalName, phones')
        .eq('is_corporate', true)
        .limit(200);
    return ((data ?? []) as any[])
        .filter((row) => (row.phones ?? []).some((p: string) => digits(String(p)).endsWith(tail)))
        .slice(0, 5) as ClientRow[];
}

/**
 * «Похоже, карточка уже есть» — одной строкой в комментарий менеджера.
 * Ровно одно совпадение — осмысленная подсказка; несколько — общий контакт,
 * молчим. Ничего не нашли — `null`, строка в заказ не добавляется.
 */
export async function existingClientHint(keys: {
    email?: string | null;
    phone?: string | null;
}): Promise<string | null> {
    const email = clean(keys.email).toLowerCase();
    const phone = clean(keys.phone);

    for (const [label, found] of [
        ['почта', email ? await byEmail(email) : []],
        ['телефон', phone ? await byPhone(phone) : []],
    ] as const) {
        if (found.length !== 1) continue;
        const card = found[0];
        const name = card.company_name || card.legalName;
        return `❗ Возможно, клиент уже есть в базе: карточка ${card.id}${name ? ` (${name})` : ''}`
            + ` — совпал ${label}. Проверьте, объедините карточки и укажите ИНН.`;
    }
    return null;
}

/**
 * Признаки клиента в том виде, в каком их читает запись заказа: `contragent`
 * с ИНН и названием плюс контакты. По ним `findOrCreateOwnClient` находит
 * карточку или заводит новую.
 */
export function clientHintsForOrder(details: {
    inn?: string | null;
    kpp?: string | null;
    companyName?: string | null;
    legalName?: string | null;
    contactName?: string | null;
} | null | undefined): Record<string, unknown> {
    const inn = clean(details?.inn);
    const legalName = clean(details?.legalName) || clean(details?.companyName);
    if (!inn && !legalName) return {};
    return {
        contragent: {
            ...(inn ? { INN: inn } : {}),
            ...(clean(details?.kpp) ? { KPP: clean(details?.kpp) } : {}),
            ...(legalName ? { legalName } : {}),
            contragentType: 'legal-entity',
        },
    };
}
