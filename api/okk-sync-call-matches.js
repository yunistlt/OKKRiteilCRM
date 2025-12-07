// api/okk-sync-call-matches.js
import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';

const {
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
} = process.env;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

export default async function handler(req, res) {
  try {
    //
    // 0) Берём рабочие статусы из справочника
    //
    const { data: statusRows, error: statusErr } = await supabase
      .from('okk_sla_status')
      .select('status_code')
      .eq('is_active', true)
      .eq('is_controlled', true);

    if (statusErr) throw statusErr;

    const WORKING_STATUS_CODES = statusRows.map((r) => r.status_code);

    //
    // 1) Берём все заказы в рабочих статусах
    //
    const { data: orders, error: ordersErr } = await supabase
      .from('okk_orders')
      .select('id, retailcrm_order_id, current_status_code')
      .in('current_status_code', WORKING_STATUS_CODES);

    if (ordersErr) throw ordersErr;

    if (!orders || orders.length === 0) {
      return res.status(200).json({ message: 'no working orders' });
    }

    let createdCalls = 0;
    let createdQueue = 0;

    //
    // 2) Идём по каждому заказу
    //
    for (const o of orders) {
      const { data: events, error: eventsErr } = await supabase
        .from('okk_history_call_events')
        .select('*')
        .eq('retailcrm_order_id', o.retailcrm_order_id);

      if (eventsErr) throw eventsErr;
      if (!events || events.length === 0) continue;

      //
      // 3) Матчим каждое событие с Telphin RAW
      //
      for (const ev of events) {
        if (!ev.call_time || !ev.client_phone_norm) continue;

        const fromTime = new Date(ev.call_time);
        const toTime = new Date(ev.call_time);

        // ищем звонки за 10 минут до call_time и до самого call_time
        fromTime.setMinutes(fromTime.getMinutes() - 10);

        const { data: rawList, error: rawErr } = await supabase
          .from('okk_calls_telphin_raw')
          .select('*')
          .gte('started_at', fromTime.toISOString())
          .lte('started_at', toTime.toISOString())
          .or(
            `from_number.eq.${ev.client_phone_norm},to_number.eq.${ev.client_phone_norm}`
          );

        if (rawErr) throw rawErr;
        if (!rawList || rawList.length === 0) continue;

        const raw = rawList[0];

        //
        // 4) Создаём запись в okk_calls
        //
        const callId = raw.id || crypto.randomUUID();

        const insertCall = {
          id: callId,
          order_id: o.id,
          manager_id: ev.manager_id || null,
          call_started_at: raw.started_at,
          duration_sec: raw.duration_sec,
          direction: raw.direction,
          phone: ev.client_phone_norm,
          result_code: raw.call_status,
          record_url: raw.storage_url,
          raw_payload: raw,
          transcript_status: 'pending',
        };

        const { error: callErr } = await supabase
          .from('okk_calls')
          .upsert(insertCall, { onConflict: 'id' });

        if (callErr) throw callErr;
        createdCalls++;

        //
        // 5) Кладём задачу в транскрибацию
        //
        if (raw.storage_url) {
          const { error: qErr } = await supabase
            .from('okk_calls_transcribe_queue')
            .insert({
              call_id: callId,
              recording_url: raw.storage_url,
              status: 'pending',
              call_started_at: raw.started_at,
              duration_sec: raw.duration_sec,
              direction: raw.direction,
              order_id: o.id,
              manager_id: ev.manager_id,
              phone: ev.client_phone_norm,
              raw_payload: raw,
            });

          if (qErr) throw qErr;
          createdQueue++;
        }
      }
    }

    return res.status(200).json({
      message: 'sync completed',
      calls_created: createdCalls,
      queued_for_transcription: createdQueue,
    });
  } catch (err) {
    console.error('okk-sync-call-matches FAILED:', err);
    return res.status(500).json({
      error: 'sync_failed',
      message: err.message,
    });
  }
}
