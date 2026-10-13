import { supabase } from '@/utils/supabase';

/**
 * Что человеку уже показывали во всплывающих оповещениях.
 *
 * Помнит система, а не браузер: у менеджера бывает два рабочих места, и
 * память одного окна другому не помогает. Отметку ставим в момент выдачи —
 * значит повтор невозможен в принципе, сколько бы раз страница ни
 * перерисовывалась (жалоба Ирины и Елены 09.10.2026).
 */

/** Какие из ключей человеку уже показывали. */
export async function alreadyShown(person: string, keys: string[]): Promise<Set<string>> {
    if (!person || !keys.length) return new Set();

    const { data, error } = await supabase
        .from('alert_seen')
        .select('alert_key')
        .eq('person', person)
        .in('alert_key', keys);

    if (error) {
        // Молчать нельзя: без этой проверки оповещения начнут повторяться.
        console.error('[alerts] не прочиталось, что уже показано:', error.message);
        return new Set();
    }

    return new Set(((data ?? []) as any[]).map((row) => String(row.alert_key)));
}

/** Запомнить, что показали. */
export async function markShown(person: string, keys: string[]): Promise<void> {
    if (!person || !keys.length) return;

    const { error } = await supabase
        .from('alert_seen')
        .upsert(
            keys.map((key) => ({ person, alert_key: key })),
            { onConflict: 'person,alert_key', ignoreDuplicates: true },
        );

    if (error) console.error('[alerts] показ не записался:', error.message);
}

/**
 * Оставить только то, что человек ещё не видел, и сразу это запомнить.
 *
 * Один вызов на все три источника: письма, задачи и звонки ходят вместе.
 */
export async function keepUnseen<T extends { id: string }>(person: string, items: T[]): Promise<T[]> {
    if (!items.length) return [];

    const shown = await alreadyShown(person, items.map((item) => item.id));
    const fresh = items.filter((item) => !shown.has(item.id));

    if (fresh.length) await markShown(person, fresh.map((item) => item.id));
    return fresh;
}
