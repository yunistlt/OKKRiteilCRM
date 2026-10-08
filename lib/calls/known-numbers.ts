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

/**
 * Какие из переданных номеров есть в карточках клиентов.
 * Возвращает карту «последние 10 цифр → id клиента».
 */
export async function knownClientPhones(phones: Array<string | null | undefined>): Promise<Map<string, number>> {
    const keys = Array.from(new Set(phones.map(phoneKey).filter(Boolean))) as string[];
    const found = new Map<string, number>();
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
        if (!found.has(tail)) found.set(tail, Number(row.client_id));
    }
    return found;
}
