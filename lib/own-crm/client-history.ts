/**
 * История карточки клиента — как история заказа, только про клиента.
 *
 * Решение владельца 22.10.2026: менеджера клиента меняет любой менеджер, но
 * «важно хранить историю действий в карточке клиента так же как мы храним в
 * карточке заказа». Запись не для отчётности, а для разбора: кто передал
 * клиента, когда поменялись реквизиты, кто склеил карточки.
 *
 * Имена полей человеческие сразу (`Менеджер клиента`, `Реквизиты`): в отличие
 * от заказа, здесь нет чужого справочника полей RetailCRM, который надо было
 * бы переводить.
 */
import { supabase } from '@/utils/supabase';

export type ClientHistoryEntry = {
    /** Что менялось — человеческим языком, его и покажем. */
    field: string;
    oldValue?: string | number | null;
    newValue?: string | number | null;
};

export type ClientHistoryActor = {
    name: string | null;
    role?: string | null;
};

const text = (value: unknown): string | null => {
    if (value === null || value === undefined || value === '') return null;
    return String(value);
};

/**
 * Записать изменения по клиенту. Молчит при ошибке: история не должна ломать
 * саму правку — лучше потерянная строка журнала, чем несохранённая карточка.
 */
export async function writeClientHistory(
    clientId: number | string,
    entries: ClientHistoryEntry[],
    actor: ClientHistoryActor,
): Promise<void> {
    const id = Number(clientId);
    const list = entries.filter((entry) => entry.field && text(entry.oldValue) !== text(entry.newValue));
    if (!Number.isFinite(id) || !list.length) return;

    try {
        const occurredAt = new Date().toISOString();
        const { error } = await supabase.from('client_history_log').insert(
            list.map((entry) => ({
                client_id: id,
                field: entry.field,
                old_value: text(entry.oldValue),
                new_value: text(entry.newValue),
                actor: { name: actor.name ?? null, role: actor.role ?? null },
                occurred_at: occurredAt,
            })),
        );
        if (error) console.warn('[client-history] не записалась:', error.message);
    } catch (err: any) {
        console.warn('[client-history] не записалась:', err?.message);
    }
}

export type ClientHistoryRow = {
    at: string;
    field: string;
    oldValue: string | null;
    newValue: string | null;
    actorName: string | null;
};

/** История карточки, свежее сверху. */
export async function loadClientHistory(clientId: number | string, limit = 100): Promise<ClientHistoryRow[]> {
    const { data, error } = await supabase
        .from('client_history_log')
        .select('field, old_value, new_value, actor, occurred_at')
        .eq('client_id', Number(clientId))
        .order('occurred_at', { ascending: false })
        .limit(limit);

    if (error) {
        console.warn('[client-history] не прочиталась:', error.message);
        return [];
    }

    return ((data ?? []) as any[]).map((row) => ({
        at: row.occurred_at,
        field: String(row.field),
        oldValue: row.old_value ?? null,
        newValue: row.new_value ?? null,
        actorName: row.actor?.name ?? null,
    }));
}
