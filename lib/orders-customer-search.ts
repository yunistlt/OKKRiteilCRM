/**
 * Поиск заказов по клиенту: карточка, а не только поля самого заказа.
 *
 * Жалобы менеджеров 06.10.2026. Евгения Матвеева: ввела «Лачинов» —
 * «под этот фильтр заказов нет», хотя заказы есть. Ирина Гордеева: то же самое
 * по номеру телефона. Причина одна: фильтр искал только внутри заказа, где
 * записан контакт («Александр Дубровский»), а не карточка клиента
 * («Лачинов Вугар»), и телефон карточки заказ тоже не хранит.
 *
 * Поэтому сначала находим карточки, подходящие под введённое, и дальше ищем
 * заказы, которые на них ссылаются. Карточки лежат в двух таблицах: `clients` —
 * наши, `customers` — приехавшие из RetailCRM; заказ ссылается на любую из них
 * через `raw_payload->customer->id`.
 */
import { supabase } from '@/utils/supabase';

/** Больше карточек в условие не кладём: запрос станет неподъёмным. */
const MAX_CARDS = 300;

/** Последние десять цифр телефона — запись номера у всех разная. */
function phoneTail(value: string): string {
    const digits = value.replace(/\D/g, '');
    return digits.length >= 10 ? digits.slice(-10) : '';
}

/** Экранируем то, что ломает условие PostgREST. */
function safe(value: string): string {
    return value.replace(/[,()]/g, ' ').trim();
}

/**
 * Номера карточек клиентов, подходящих под введённый текст.
 *
 * Пустой ответ означает «карточек не нашлось» — заказы всё равно ищутся по
 * собственным полям, поэтому поиск по контакту заказа продолжает работать.
 */
export async function clientIdsByText(text: string): Promise<string[]> {
    const v = safe(text);
    if (v.length < 2) return [];

    const tail = phoneTail(v);
    const ids = new Set<string>();

    const nameLike = `%${v}%`;
    const phoneLike = tail ? `%${tail}%` : null;

    const [own, crm] = await Promise.all([
        supabase
            .from('clients')
            .select('id')
            .or([
                `first_name.ilike.${nameLike}`,
                `last_name.ilike.${nameLike}`,
                `company_name.ilike.${nameLike}`,
                `contact_name.ilike.${nameLike}`,
                `email.ilike.${nameLike}`,
                `inn.ilike.${nameLike}`,
            ].join(','))
            .limit(MAX_CARDS),
        supabase
            .from('customers')
            .select('id')
            .or([
                `firstName.ilike.${nameLike}`,
                `lastName.ilike.${nameLike}`,
                `email.ilike.${nameLike}`,
            ].join(','))
            .limit(MAX_CARDS),
    ]);

    for (const row of (own.data || []) as any[]) ids.add(String(row.id));
    for (const row of (crm.data || []) as any[]) ids.add(String(row.id));

    /**
     * Телефоны лежат массивом, и записаны они по-разному: «+7…», «8…», слитно.
     * Сравнение массива по образцу PostgREST не умеет, поэтому за телефоны
     * отвечает функция в базе — она же нормализует номер.
     */
    if (phoneLike) {
        const { data } = await supabase.rpc('client_ids_by_phone_tail', { p_tail: tail, p_limit: MAX_CARDS });
        for (const row of (data || []) as any[]) {
            ids.add(String(typeof row === 'object' ? Object.values(row)[0] : row));
        }
    }

    return Array.from(ids).slice(0, MAX_CARDS);
}
