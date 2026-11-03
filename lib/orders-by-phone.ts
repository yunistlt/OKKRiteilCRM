/**
 * Заказы по номеру телефона — один поиск на всю систему.
 *
 * Вопрос «к какому заказу относится этот номер» задают четыре места: строгая
 * автопривязка звонка, окно активного звонка, список оповещений и секретарь
 * Телфина («чей клиент звонит»). До 03.11.2026 каждое спрашивало по-своему, и
 * три из четырёх спрашивали неправильно: искали цифры подстрокой в номере
 * «как записан» — `phone ilike '%3553161%'` в строке `+7(909)355-31-61`.
 * Такого вхождения там нет, и заказ не находился вовсе.
 *
 * Ирина Гордеева 03.11.2026 (доработки №75 и №77): «звонок был, задача в Мой
 * день не ушла», «задача приходит каждый день». По заказу 54013 (СТМ-Сервис)
 * за неделю шесть состоявшихся разговоров, и ни один не привязался к заказу:
 * телефон клиента записан со скобками и дефисами. Плана дня это касается
 * напрямую — задачу закрывает разговор, а разговора система не видела.
 * Таких заказов было 233 из 658 открытых — каждый третий.
 *
 * Ищем по вычисляемым колонкам `orders.phone_tail7` и
 * `additional_phone_tail7` (миграция 20261014_orders_phone_tail.sql): это
 * последние семь цифр номера, они не зависят от того, кто и как записал
 * телефон, и под каждой есть индекс.
 */
import { supabase } from '@/utils/supabase';
import { normalizePhone } from './phone-utils';

export type OrdersByPhoneOptions = {
    /** Какие колонки нужны: читатель один, а экраны просят разное. */
    columns: string;
    /** Сколько заказов вернуть, свежими вперёд. */
    limit?: number;
    /**
     * По какой колонке «свежие первыми». В заказах их две: `created_at` у
     * наших и `createdAt` у приехавших из ритейла — выбирает вызывающий.
     */
    orderBy?: 'created_at' | 'createdAt';
    /** Удалённые в CRM заказы в ответ не идут; true — вернуть и их. */
    withDeleted?: boolean;
};

/**
 * Последние семь цифр номера — ключ поиска.
 *
 * Семь, а не десять: этого хватает, чтобы различить клиентов, и это переживает
 * «8» против «+7» в начале. Добавочный в хвосте убирает `normalizePhone`.
 * Короткий номер (внутренний добавочный, служебная строка) ключом не бывает —
 * тогда null, и поиск не делается вовсе.
 */
export function phoneTail7(phone: string | null | undefined): string | null {
    const normalized = normalizePhone(phone);
    if (!normalized) return null;
    const digits = normalized.replace(/\D/g, '');
    return digits.length >= 10 ? digits.slice(-7) : null;
}

/** Условие PostgREST по хвостам: номер мог быть записан как основной или как дополнительный. */
export function phoneTailFilter(tails: string[]): string {
    return tails.flatMap((tail) => [`phone_tail7.eq.${tail}`, `additional_phone_tail7.eq.${tail}`]).join(',');
}

/** Заказы сразу по нескольким номерам: страница оповещений спрашивает про сорок звонков разом. */
export async function findOrdersByPhones(
    phones: Array<string | null | undefined>,
    opts: OrdersByPhoneOptions,
): Promise<any[]> {
    const tails = Array.from(new Set(phones.map(phoneTail7).filter((t): t is string => Boolean(t))));
    if (!tails.length) return [];

    let query = supabase
        .from('orders')
        .select(opts.columns)
        .or(phoneTailFilter(tails))
        .order(opts.orderBy ?? 'created_at', { ascending: false })
        .limit(opts.limit ?? 10);

    if (!opts.withDeleted) query = query.is('crm_deleted_at', null);

    const { data, error } = await query;
    if (error) throw new Error(error.message);
    return (data ?? []) as any[];
}

/** Заказы по одному номеру, свежими вперёд. */
export async function findOrdersByPhone(
    phone: string | null | undefined,
    opts: OrdersByPhoneOptions,
): Promise<any[]> {
    return findOrdersByPhones([phone], opts);
}
