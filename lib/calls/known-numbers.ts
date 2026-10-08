import { supabase } from '@/utils/supabase';

/**
 * Номера, записанные в карточках клиентов.
 *
 * Требование владельца 08.10.2026: звонить из реестра звонков можно ТОЛЬКО на
 * номера, внесённые в карточку клиента. В реестре попадаются автоответчики,
 * переадресации, номера чужих компаний и ошибочные наборы — набирать их
 * кнопкой нельзя.
 *
 * Сверяем по последним десяти цифрам: один и тот же номер записан по-разному
 * («+7 (995) 344-68-62», «89953446862»), и сравнение строк ничего не находит.
 */
export function phoneKey(value: unknown): string | null {
    const digits = String(value ?? '').replace(/\D/g, '');
    return digits.length >= 10 ? digits.slice(-10) : null;
}

export type KnownPhone = { clientId: number; name: string | null };

/**
 * Какие из переданных номеров есть в карточках клиентов.
 * Возвращает карту «последние 10 цифр → карточка (id и имя)».
 */
export async function knownClientPhones(phones: Array<string | null | undefined>): Promise<Map<string, KnownPhone>> {
    const keys = Array.from(new Set(phones.map(phoneKey).filter(Boolean))) as string[];
    const found = new Map<string, KnownPhone>();
    if (!keys.length) return found;

    // Сверку делает база: телефоны лежат массивами в двух таблицах, и тянуть
    // 31 тысячу карточек в приложение ради сравнения нельзя.
    const { data, error } = await supabase.rpc('known_client_phones', { p_tails: keys });
    if (error) {
        console.warn('[known-phones] сверка не прошла:', error.message);
        return found;
    }

    for (const row of ((data ?? []) as any[])) {
        const tail = String(row.tail);
        if (!found.has(tail)) found.set(tail, { clientId: Number(row.client_id), name: null });
    }

    /**
     * Имя для колонки «Клиент». Карточка компании и карточка человека живут в
     * разных таблицах с общими номерами, поэтому спрашиваем обе: что нашлось
     * первым, то и показываем.
     */
    const ids = Array.from(new Set(Array.from(found.values()).map((v) => v.clientId)));
    if (ids.length) {
        const [companies, people] = await Promise.all([
            supabase.from('clients').select('id, company_name, "legalName", contact_name').in('id', ids),
            supabase.from('customers').select('id, "firstName", "lastName"').in('id', ids),
        ]);

        const names = new Map<number, string>();
        for (const c of ((companies.data ?? []) as any[])) {
            const name = c.company_name || c.legalName || c.contact_name;
            if (name) names.set(Number(c.id), String(name));
        }
        for (const p of ((people.data ?? []) as any[])) {
            const name = [p.lastName, p.firstName].filter(Boolean).join(' ').trim();
            if (name && !names.has(Number(p.id))) names.set(Number(p.id), name);
        }

        for (const [tail, value] of Array.from(found.entries())) {
            found.set(tail, { ...value, name: names.get(value.clientId) ?? null });
        }
    }

    return found;
}
