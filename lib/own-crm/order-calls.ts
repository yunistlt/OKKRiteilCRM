/**
 * Звонки по заказу для карточки.
 *
 * Источник — НАШИ звонки Телфина. До 09.10.2026 строки собирались от
 * `retailcrm_calls`: номер заказа у звонка проставляла сама RetailCRM, и это
 * было надёжнее нашего матчинга по телефону. От RetailCRM отвязались, таблица
 * не наполняется, и порядок перевернулся: главной стала наша привязка
 * (`call_order_matches` — набрали из карточки, привязали руками, поймала
 * автопривязка), а выгрузка RetailCRM осталась ХВОСТОМ для звонков до отвязки.
 *
 * Что здесь нельзя потерять (разбор 01.10.2026, когда модуль и появился):
 *
 *  1. Один наш звонок Телфина содержит несколько «ног» разговора
 *     (`record_uuids`), а RetailCRM считала их разными звонками. Поэтому на
 *     архивную строку заводится своя строка, даже если запись у них общая:
 *     иначе на заказе 54890 из пяти разговоров менеджер видел четыре.
 *  2. Наш матчинг раньше подключался только там, где RetailCRM не знала о
 *     заказе ничего: 941 заказ и 5 210 звонков скрывались. Теперь наоборот —
 *     наши звонки показываются всегда.
 *  3. У 4 123 звонков RetailCRM нашей записи нет вовсе. Строка остаётся, просто
 *     без записи и расшифровки.
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
    /** Откуда знаем про звонок: наша привязка или архив RetailCRM. */
    source: 'crm' | 'match';
    /** Есть ли у нас сама запись разговора. */
    hasRecording: boolean;
    /** Кто говорил — добавочный из записи звонка. */
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
    manager_extension: string | null;
};

const TELPHIN_FIELDS =
    'telphin_call_id, direction, started_at, duration_sec, recording_url, transcript, record_uuids, manager_extension';

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
        extension: row.manager_extension || null,
    };
}

export async function loadOrderCalls(params: { orderNumber: string; orderRowId: number }): Promise<OrderCall[]> {
    const calls: OrderCall[] = [];
    const usedTelphinIds = new Set<string>();

    // 1. Наша привязка — главный источник. Единственный живой с 09.10.2026.
    const { data: matched } = await supabase
        .from('call_order_matches')
        .select('telphin_call_id')
        .eq('retailcrm_order_id', params.orderRowId);

    const ourIds = Array.from(
        new Set(((matched ?? []) as any[]).map((m) => m.telphin_call_id).filter(Boolean).map(String)),
    );

    if (ourIds.length) {
        const { data: ourRows } = await supabase.from('raw_telphin_calls').select(TELPHIN_FIELDS).in('telphin_call_id', ourIds);

        for (const row of ((ourRows ?? []) as TelphinRow[])) {
            usedTelphinIds.add(row.telphin_call_id);
            calls.push(toCall(row, 'match'));
        }
    }

    // 2. Хвост: звонки до отвязки, про которые знает только выгрузка RetailCRM.
    //    Чтение архива осознанное — у старых заказов это единственный способ
    //    увидеть разговор. Новых строк здесь не появляется.
    const { data: crmCalls } = await supabase
        .from('retailcrm_calls')
        .select('rc_call_id, external_id, call_date, call_type, duration_sec, ext_code')
        .eq('order_number', params.orderNumber)
        .order('call_date', { ascending: false });

    const externalIds = ((crmCalls ?? []) as any[]).map((c) => c.external_id).filter(Boolean);

    // Наши записи ищем по «ногам» разговора: у одной записи их бывает несколько.
    const byExternalId = new Map<string, TelphinRow>();
    if (externalIds.length) {
        const { data: telphinRows } = await supabase.from('raw_telphin_calls').select(TELPHIN_FIELDS).overlaps('record_uuids', externalIds);

        for (const row of ((telphinRows ?? []) as TelphinRow[])) {
            for (const uuid of row.record_uuids ?? []) {
                byExternalId.set(uuid, row);
            }
        }
    }

    for (const crm of ((crmCalls ?? []) as any[])) {
        const record = crm.external_id ? byExternalId.get(crm.external_id) : undefined;
        // Этот разговор уже показан по нашей привязке — второй строкой не идёт.
        if (record && usedTelphinIds.has(record.telphin_call_id)) continue;

        calls.push({
            // Ключ — звонок RetailCRM: двух одинаковых строк не будет, даже если
            // запись у разговоров общая.
            id: record ? `${record.telphin_call_id}:${crm.rc_call_id}` : `crm:${crm.rc_call_id}`,
            // Время и длительность — из архива: у общей записи они одни на всех.
            date: crm.call_date ?? record?.started_at ?? null,
            type: crm.call_type === 'in' ? 'incoming' : crm.call_type === 'out' ? 'outgoing' : record?.direction ?? null,
            duration: crm.duration_sec ?? record?.duration_sec ?? null,
            transcription: record?.transcript || null,
            summary: null,
            link: record?.recording_url || null,
            source: 'crm',
            hasRecording: Boolean(record?.recording_url),
            extension: record?.manager_extension || crm.ext_code || null,
        });
    }

    // Свежие сверху — так же, как было.
    return calls.sort((a, b) => new Date(b.date ?? 0).getTime() - new Date(a.date ?? 0).getTime());
}
