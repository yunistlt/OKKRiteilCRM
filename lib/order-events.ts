// ============================================================================
// События заказа (история изменений из RetailCRM) — единая точка доступа.
//
// Канонический источник — `order_history_log`: его наполняет воркер
// retailcrm-history-delta (курсор sinceId, крон каждые 2 минуты). Легаси-таблица
// `raw_order_events` наполнялась старым fallback-синком /api/sync/history,
// который отключается, когда включён realtime-пайплайн, поэтому с апреля 2026
// она заморожена. Читать её нельзя — данные там мёртвые.
//
// Схемы отличаются, и это единственное место, где о различии нужно знать:
//   raw_order_events.event_type  → order_history_log.field
//   raw_order_events.raw_payload → order_history_log.old_value / new_value
//   raw_order_events.manager_id  → order_history_log.user_data->>'id'
// Телефонов (phone_normalized и т.п.) в истории нет вовсе — они были
// денормализацией старого синка; телефон берётся из `orders`.
//
// Значения old_value/new_value — текст. У полей-справочников (status и др.) это
// JSON-строка вида {"code":"tender","name":"Тендер"}, у комментариев и дат —
// обычный текст, у пустого значения — литерал 'null'. Разбор — в parseEventValue.
// ============================================================================

import { supabase } from '@/utils/supabase';

export interface OrderEvent {
    orderId: number;
    /** Код изменённого поля («status», «manager_comment», «email», …). */
    field: string;
    occurredAt: string;
    oldValue: string | null;
    newValue: string | null;
    /** Автор изменения (пользователь CRM), если известен. */
    userId: number | null;
}

/**
 * Разбирает значение поля истории: JSON-объект справочника → объект, «null» и
 * пустая строка → null, остальное → строка как есть.
 */
export function parseEventValue(raw: string | null | undefined): any {
    if (raw == null) return null;
    const text = String(raw);
    if (text === '' || text === 'null') return null;
    const trimmed = text.trim();
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
        try {
            return JSON.parse(trimmed);
        } catch {
            return text;
        }
    }
    return text;
}

/** Человекочитаемое значение поля истории: у справочников — name, иначе текст. */
export function formatEventValue(raw: string | null | undefined): string {
    const value = parseEventValue(raw);
    if (value == null) return '';
    if (typeof value === 'object') return value.name ?? value.code ?? JSON.stringify(value);
    return String(value);
}

function toEvent(row: any): OrderEvent {
    return {
        orderId: Number(row.retailcrm_order_id),
        field: String(row.field ?? ''),
        occurredAt: row.occurred_at,
        oldValue: row.old_value ?? null,
        newValue: row.new_value ?? null,
        userId: row.user_data?.id != null ? Number(row.user_data.id) : null,
    };
}

/** Все события заказа, по возрастанию времени (или по убыванию при desc). */
export async function fetchOrderEvents(
    orderId: number,
    opts: { desc?: boolean; limit?: number } = {},
): Promise<OrderEvent[]> {
    let q = supabase
        .from('order_history_log')
        .select('retailcrm_order_id,field,occurred_at,old_value,new_value,user_data')
        .eq('retailcrm_order_id', orderId)
        .order('occurred_at', { ascending: !opts.desc });
    if (opts.limit) q = q.limit(opts.limit);
    const { data } = await q;
    return ((data as any[]) ?? []).map(toEvent);
}

/**
 * Сколько у заказа событий по полям, подходящим под ILIKE-шаблоны
 * (например '%comment%'). Шаблоны те же, что были у event_type: имена полей в
 * обеих таблицах совпадают — это одна и та же история из RetailCRM.
 */
export async function countOrderEventsByField(orderId: number, patterns: string[]): Promise<number> {
    if (!patterns.length) return 0;
    const { count } = await supabase
        .from('order_history_log')
        .select('retailcrm_history_id', { count: 'exact', head: true })
        .eq('retailcrm_order_id', orderId)
        .or(patterns.map((p) => `field.ilike.${p}`).join(','));
    return count || 0;
}

/** Поля-коммуникации: комментарии, письма, сообщения. */
export const COMMUNICATION_FIELD_PATTERNS = ['%comment%', '%email%', '%message%'];
export const COMMENT_FIELD_PATTERNS = ['%comment%'];
export const EMAIL_FIELD_PATTERNS = ['%email%'];

/**
 * Строка истории в форме, которую ждёт rule-engine (наследие raw_order_events):
 * `event_type` + `raw_payload.{field,oldValue,newValue}`. Нужна, чтобы перевод
 * движка правил на живой источник не переписывал его блоки условий.
 *
 * Смену статуса движок опознаёт по event_type = 'status_changed', тогда как в
 * истории поле называется 'status' — переименовываем здесь, в одном месте.
 */
export function toLegacyEventRow(row: any): any {
    const field = String(row.field ?? '');
    return {
        retailcrm_order_id: Number(row.retailcrm_order_id),
        event_id: row.retailcrm_history_id,
        event_type: field === 'status' ? 'status_changed' : field,
        occurred_at: row.occurred_at,
        manager_id: row.user_data?.id != null ? Number(row.user_data.id) : null,
        raw_payload: {
            field,
            oldValue: parseEventValue(row.old_value),
            newValue: parseEventValue(row.new_value),
        },
    };
}

/** Код поля истории для смены статуса (в raw_order_events было 'status_changed'). */
export const STATUS_FIELD = 'status';
