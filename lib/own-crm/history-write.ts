/**
 * Запись истории своих заказов.
 *
 * `order_history_log` наполняла только синхронизация RetailCRM, поэтому у
 * заказов, созданных у нас, история была пустой — «Изменений по заказу пока не
 * записано» сразу после создания (замечание владельца 02.10.2026: «создан
 * новый заказ — это уже история, сделай 1 в 1 как в ритейле»).
 *
 * Пишем теми же именами полей, что присылает RetailCRM (`status`,
 * `manager_comment`, `order_product`, `custom_<код>`…) — тогда перевод истории
 * на человеческий язык (`lib/own-crm/history.ts`) работает одинаково для своих
 * и приехавших заказов, и ничего не надо учить заново.
 */
import { supabase } from '@/utils/supabase';

export type HistoryEntry = {
    /** Имя поля в терминах RetailCRM. */
    field: string;
    oldValue?: string | number | null;
    newValue?: string | number | null;
};

const text = (value: unknown): string | null => {
    if (value === null || value === undefined || value === '') return null;
    return String(value);
};

/**
 * Записать изменения по заказу. `actorId` — номер менеджера, который правил:
 * история показывает его фамилией, как у RetailCRM.
 */
export async function writeOwnHistory(
    orderId: number,
    entries: HistoryEntry[],
    actorId?: number | null,
): Promise<void> {
    const list = entries.filter((entry) => entry.field);
    if (!Number.isFinite(orderId) || !list.length) return;

    try {
        // Номера записей — из своего счётчика: `retailcrm_history_id` уникален,
        // и у приехавших из RetailCRM он занят её номерами.
        const { data: ids } = await supabase.rpc('next_own_history_ids', { count_needed: list.length });
        const numbers = ((ids ?? []) as any[]).map((row) =>
            Number(typeof row === 'object' ? Object.values(row)[0] : row),
        );

        if (numbers.length !== list.length || numbers.some((id) => !Number.isFinite(id))) {
            console.warn('[own-history] счётчик не выдал номера — историю не пишем');
            return;
        }

        const occurredAt = new Date().toISOString();
        const rows = list.map((entry, index) => ({
            retailcrm_history_id: numbers[index],
            retailcrm_order_id: orderId,
            field: entry.field,
            old_value: text(entry.oldValue),
            new_value: text(entry.newValue),
            user_data: actorId ? { id: Number(actorId) } : null,
            occurred_at: occurredAt,
        }));

        const { error } = await supabase.from('order_history_log').insert(rows);
        if (error) throw new Error(error.message);
    } catch (e: any) {
        // История важна, но заказ важнее: правка не должна падать из-за неё.
        console.warn('[own-history] не записал историю:', e.message);
    }
}

/**
 * Человеческие значения для истории: в RetailCRM история читается словами, а
 * не кодами. Статус — названием, менеджер — фамилией, сумма — с разрядами.
 */
export async function statusName(code: unknown): Promise<string> {
    const value = String(code ?? '').trim();
    if (!value) return '';
    const { data } = await supabase
        .from('crm_statuses')
        .select('name')
        .eq('external_code', value)
        .maybeSingle();
    return String((data as any)?.name || value);
}

export async function managerName(id: unknown): Promise<string> {
    const value = Number(id);
    if (!Number.isFinite(value)) return '';
    const { data } = await supabase
        .from('managers')
        .select('first_name, last_name')
        .eq('id', value)
        .maybeSingle();
    const row = data as any;
    return [row?.last_name, row?.first_name].filter(Boolean).join(' ') || String(value);
}

export function moneyValue(amount: unknown): string {
    const value = Number(amount);
    return Number.isFinite(value) ? `${Math.round(value).toLocaleString('ru-RU')} ₽` : '';
}

/**
 * Значение своего поля заказа человеческим языком: код справочника
 * («verstaki») заменяем на его название («Верстаки»). Имена берём из
 * справочников RetailCRM — закон «имена из RetailCRM».
 */
export async function customFieldValueName(fieldCode: string, value: unknown): Promise<string> {
    const raw = String(value ?? '').trim();
    if (!raw) return '';

    const { data: field } = await supabase
        .from('retailcrm_custom_fields')
        .select('dictionary')
        .eq('code', fieldCode)
        .not('dictionary', 'is', null)
        .limit(1)
        .maybeSingle();

    const dictionary = (field as any)?.dictionary;
    if (!dictionary) return raw;

    const { data: item } = await supabase
        .from('retailcrm_dictionaries')
        .select('item_name')
        .eq('entity_type', 'customField')
        .eq('dictionary_code', dictionary)
        .eq('item_code', raw)
        .maybeSingle();

    return String((item as any)?.item_name || raw);
}

/** Человеческое имя позиции для записи «Добавлен товар». */
export function itemLabel(item: { name?: string | null; quantity?: number | null; price?: number | null }): string {
    const parts = [String(item.name ?? 'Позиция').trim()];
    if (item.quantity) parts.push(`${item.quantity} шт`);
    if (item.price) parts.push(`${Math.round(Number(item.price)).toLocaleString('ru-RU')} ₽`);
    return parts.join(' · ');
}
