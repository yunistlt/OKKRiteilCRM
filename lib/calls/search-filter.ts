import { supabase } from '@/utils/supabase';
import { phoneKey } from '@/lib/calls/known-numbers';
import { clientCallKeys, likeValue } from '@/lib/calls-client-search';

/**
 * Поиск по реестру звонков: одно поле — «Клиент, телефон, заказ или менеджер».
 *
 * У строки звонка из Телфина нет ни клиента, ни менеджера, ни заказа — только
 * номера телефонов, добавочный сотрудника и идентификаторы записей. Поэтому по
 * тексту сначала находим, чем звонок мог быть помечен (телефоны клиента,
 * добавочный менеджера, записи заказа), и уже этим фильтруем список.
 *
 * Жалоба владельца 15.10.2026: «не работает фильтр ни по менеджерам, ни по
 * фамилии клиентов». По менеджеру поиска не было вовсе; телефоны клиента
 * сверялись целиком («79137136987»), а у звонка номер хранится последними
 * десятью цифрами («9137136987») — не совпадало никогда.
 */

/** Сколько значений берём в один фильтр: запрос уезжает в строку адреса. */
const MAX_VALUES = 400;
/** Идентификаторы звонков длинные (32 знака) — их берём меньше, чтобы адрес запроса не вырос. */
const MAX_CALL_IDS = 150;

/** Добавочные менеджеров, чья фамилия или имя похожи на запрос. */
async function managerExtensions(text: string): Promise<string[]> {
    const like = likeValue(text);
    const { data } = await supabase
        .from('managers')
        .select('telphin_extension')
        .or(`first_name.ilike.${like},last_name.ilike.${like}`)
        .not('telphin_extension', 'is', null)
        .limit(50);
    const extensions = ((data ?? []) as any[])
        .map((row) => String(row.telphin_extension ?? '').trim())
        .filter(Boolean);
    return Array.from(new Set(extensions));
}

/** Записи звонков, которые RetailCRM пометила этим менеджером (старые звонки). */
async function crmUuidsByManager(text: string): Promise<string[]> {
    const { data } = await supabase
        .from('retailcrm_calls')
        .select('external_id')
        .ilike('manager_name', `%${text}%`)
        .not('external_id', 'is', null)
        .limit(MAX_VALUES);
    return ((data ?? []) as any[]).map((row) => String(row.external_id));
}

/** Звонки заказов с такими номерами: наша привязка и привязка RetailCRM. */
async function callsOfOrders(numbers: string[]): Promise<{ callIds: string[]; uuids: string[] }> {
    if (!numbers.length) return { callIds: [], uuids: [] };
    const take = numbers.slice(0, MAX_VALUES);

    const { data: orderRows } = await supabase.from('orders').select('id').in('number', take).limit(MAX_VALUES);
    const orderIds = ((orderRows ?? []) as any[]).map((row) => Number(row.id)).filter(Number.isFinite);

    const [links, crm] = await Promise.all([
        orderIds.length
            ? supabase
                  .from('call_order_matches')
                  .select('telphin_call_id')
                  .in('retailcrm_order_id', orderIds)
                  .limit(MAX_VALUES)
            : Promise.resolve({ data: [] as any[] }),
        supabase
            .from('retailcrm_calls')
            .select('external_id')
            .in('order_number', take)
            .not('external_id', 'is', null)
            .limit(MAX_VALUES),
    ]);

    return {
        callIds: (((links as any).data ?? []) as any[]).map((row) => String(row.telphin_call_id)),
        uuids: (((crm as any).data ?? []) as any[]).map((row) => String(row.external_id)),
    };
}

/**
 * Условия PostgREST для `.or(...)`: звонок подходит, если совпало хоть одно.
 * Пустой список — искать нечего, список звонков остаётся как есть.
 */
export async function buildCallSearchFilter(search: string): Promise<string[]> {
    const text = search.trim();
    if (!text) return [];

    const parts: string[] = [`from_number.ilike.${likeValue(text)}`, `to_number.ilike.${likeValue(text)}`];

    // Телефон: у звонка номер хранится последними десятью цифрами.
    const digits = text.replace(/\D/g, '');
    if (digits.length >= 4) {
        const tail = phoneKey(digits) ?? digits;
        parts.push(`from_number_normalized.ilike.%${tail}%`, `to_number_normalized.ilike.%${tail}%`);
    }

    const [clientKeys, extensions, managerUuids] = await Promise.all([
        clientCallKeys(text),
        managerExtensions(text),
        crmUuidsByManager(text),
    ]);

    // Клиент: его телефоны из карточки.
    const clientPhones = Array.from(
        new Set(clientKeys.phones.map((phone) => phoneKey(phone)).filter((v): v is string => !!v)),
    ).slice(0, MAX_VALUES);
    if (clientPhones.length) {
        parts.push(`from_number_normalized.in.(${clientPhones.join(',')})`);
        parts.push(`to_number_normalized.in.(${clientPhones.join(',')})`);
    }

    // Менеджер: добавочный в самой записи звонка.
    if (extensions.length) parts.push(`manager_extension.in.(${extensions.join(',')})`);

    // Заказ: номер из запроса и заказы найденного клиента.
    const orderNumbers = Array.from(new Set([...(/^\d{3,9}$/.test(digits) ? [digits] : []), ...clientKeys.orderNumbers]));
    const ofOrders = await callsOfOrders(orderNumbers);

    // Записи RetailCRM переводим в звонки Телфина отдельным запросом: список в
    // фигурных скобках внутри `or(...)` разобрать нельзя — запятые в нём
    // прочитаются как разделители условий.
    const uuids = Array.from(new Set([...managerUuids, ...ofOrders.uuids])).slice(0, MAX_VALUES);
    const byUuid = uuids.length
        ? (
              await supabase
                  .from('raw_telphin_calls')
                  .select('telphin_call_id')
                  .overlaps('record_uuids', uuids)
                  .limit(MAX_VALUES)
          ).data ?? []
        : [];

    const callIds = Array.from(
        new Set([...ofOrders.callIds, ...((byUuid as any[]).map((row) => String(row.telphin_call_id)))]),
    ).slice(0, MAX_CALL_IDS);
    if (callIds.length) parts.push(`telphin_call_id.in.(${callIds.join(',')})`);

    return parts;
}
