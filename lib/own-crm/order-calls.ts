/**
 * Звонки по заказу для карточки.
 *
 * Источник правды — RetailCRM: номер заказа у звонка проставляет она, и наш
 * матчинг по телефону ошибается примерно в трети случаев (закон проекта).
 * Но брать только привязку мало — вот что терялось до 01.10.2026:
 *
 *  1. Один наш звонок Телфина содержит несколько «ног» разговора
 *     (`record_uuids`), а RetailCRM считает их разными звонками. Выборка «наши
 *     записи по списку id» схлопывала их в одну строку: на заказе 54890 из пяти
 *     разговоров менеджер видел четыре — пропадал разговор другого сотрудника.
 *     Затронуто 435 заказов и 762 строки.
 *  2. Наш матчинг подключался только там, где RetailCRM не знала о заказе
 *     ничего. Если она знала хоть один звонок, остальные найденные нами
 *     скрывались: 941 заказ, 5 210 звонков.
 *  3. У 4 123 звонков RetailCRM нашей записи нет вовсе — раньше их не было
 *     видно; теперь строка остаётся, просто без записи и расшифровки.
 *
 * Поэтому строки собираются от RetailCRM (один разговор — одна строка), запись
 * и расшифровка подтягиваются к ним, а сверху добавляются звонки нашего
 * матчинга, которых в RetailCRM нет.
 */
import { supabase } from '@/utils/supabase';

export type OrderCall = {
    id: string;
    date: string | null;
    type: string | null;
    duration: number | null;
    transcription: string | null;
    summary: string | null;
    link: string | null;
    /** Откуда знаем про звонок: привязка RetailCRM или наш матчинг. */
    source: 'crm' | 'match';
    /** Есть ли у нас сама запись разговора. */
    hasRecording: boolean;
    /** Кто говорил — добавочный из RetailCRM, если она его назвала. */
    extension: string | null;
};

type TelphinRow = {
    telphin_call_id: string;
    direction: string | null;
    started_at: string | null;
    duration_sec: number | null;
    recording_url: string | null;
    transcript: string | null;
    record_uuids: string[] | null;
};

function toCall(row: TelphinRow, source: 'crm' | 'match'): OrderCall {
    return {
        id: row.telphin_call_id,
        date: row.started_at,
        type: row.direction,
        duration: row.duration_sec,
        transcription: row.transcript || null,
        summary: null,
        link: row.recording_url || null,
        source,
        hasRecording: Boolean(row.recording_url),
        extension: null,
    };
}

export async function loadOrderCalls(params: { orderNumber: string; orderRowId: number }): Promise<OrderCall[]> {
    const calls: OrderCall[] = [];
    const usedTelphinIds = new Set<string>();

    // 1. Разговоры, про которые знает RetailCRM: по строке на каждый.
    const { data: crmCalls } = await supabase
        .from('retailcrm_calls')
        .select('rc_call_id, external_id, call_date, call_type, duration_sec, ext_code')
        .eq('order_number', params.orderNumber)
        .order('call_date', { ascending: false });

    const externalIds = ((crmCalls ?? []) as any[]).map((c) => c.external_id).filter(Boolean);

    // Наши записи ищем по «ногам» разговора: у одной записи их бывает несколько.
    let byExternalId = new Map<string, TelphinRow>();
    if (externalIds.length) {
        const { data: telphinRows } = await supabase
            .from('raw_telphin_calls')
            .select('telphin_call_id, direction, started_at, duration_sec, recording_url, transcript, record_uuids')
            .overlaps('record_uuids', externalIds);

        for (const row of ((telphinRows ?? []) as TelphinRow[])) {
            for (const uuid of row.record_uuids ?? []) {
                byExternalId.set(uuid, row);
            }
        }
    }

    for (const crm of ((crmCalls ?? []) as any[])) {
        const record = crm.external_id ? byExternalId.get(crm.external_id) : undefined;
        if (record) {
            usedTelphinIds.add(record.telphin_call_id);
        }

        calls.push({
            // Ключ — звонок RetailCRM: двух одинаковых строк не будет, даже если
            // запись у разговоров общая.
            id: record ? `${record.telphin_call_id}:${crm.rc_call_id}` : `crm:${crm.rc_call_id}`,
            // Время и длительность — из RetailCRM: у общей записи они одни на всех.
            date: crm.call_date ?? record?.started_at ?? null,
            type: crm.call_type === 'in' ? 'incoming' : crm.call_type === 'out' ? 'outgoing' : record?.direction ?? null,
            duration: crm.duration_sec ?? record?.duration_sec ?? null,
            transcription: record?.transcript || null,
            summary: null,
            link: record?.recording_url || null,
            source: 'crm',
            hasRecording: Boolean(record?.recording_url),
            extension: crm.ext_code || null,
        });
    }

    // 2. Звонки нашего матчинга, которых в RetailCRM нет. Раньше они скрывались
    //    целиком, если RetailCRM знала по заказу хоть один звонок.
    const { data: matched } = await supabase
        .from('call_order_matches')
        .select('telphin_call_id')
        .eq('retailcrm_order_id', params.orderRowId);

    const extraIds = Array.from(
        new Set(((matched ?? []) as any[]).map((m) => m.telphin_call_id).filter((id) => id && !usedTelphinIds.has(id))),
    );

    if (extraIds.length) {
        const { data: extraRows } = await supabase
            .from('raw_telphin_calls')
            .select('telphin_call_id, direction, started_at, duration_sec, recording_url, transcript, record_uuids')
            .in('telphin_call_id', extraIds);

        for (const row of ((extraRows ?? []) as TelphinRow[])) {
            calls.push(toCall(row, 'match'));
        }
    }

    // Свежие сверху — так же, как было.
    return calls.sort((a, b) => new Date(b.date ?? 0).getTime() - new Date(a.date ?? 0).getTime());
}
