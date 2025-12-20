// api/okk-sync-calls-telphin-all.js
import { createClient } from '@supabase/supabase-js';

const {
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
  TELPHIN_CLIENT_ID,
  TELPHIN_CLIENT_SECRET,
} = process.env;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const TELPHIN_API_BASE = 'https://apiproxy.telphin.ru';
const TELPHIN_API_VERSION = '/api/ver1.0';

function formatTelphinDate(date) {
  const pad = (n) => String(n).padStart(2, '0');
  return (
    date.getFullYear() +
    '-' +
    pad(date.getMonth() + 1) +
    '-' +
    pad(date.getDate()) +
    ' ' +
    pad(date.getHours()) +
    ':' +
    pad(date.getMinutes()) +
    ':' +
    pad(date.getSeconds())
  );
}

function normalizePhone(val) {
  if (!val) return null;
  return String(val).replace(/[^\d+]/g, '');
}

async function getTelphinToken() {
  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: TELPHIN_CLIENT_ID,
    client_secret: TELPHIN_CLIENT_SECRET,
    scope: 'all',
  });

  const resp = await fetch(`${TELPHIN_API_BASE}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });

  const json = await resp.json();
  if (!resp.ok) throw new Error(JSON.stringify(json));

  return json;
}

async function fetchTelphinRecords(accessToken, { extensionId, from, to }) {
  const params = new URLSearchParams({
    start_datetime: formatTelphinDate(from),
    end_datetime: formatTelphinDate(to),
    order: 'asc',
  });

  const resp = await fetch(
    `${TELPHIN_API_BASE}${TELPHIN_API_VERSION}/extension/${extensionId}/record/?${params.toString()}`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );

  const json = await resp.json();
  if (!resp.ok) throw new Error(JSON.stringify(json));

  return json;
}

export default async function handler(req, res) {
  const now = new Date();
  let from;
  let to = now;
  let total = 0;

  try {
    // --- читаем состояние синка ---
    const { data: state, error: stateErr } = await supabase
      .from('okk_sync_state')
      .select('updated_at, is_completed')
      .eq('sync_type', 'telphin_calls')
      .single();

    if (stateErr) throw stateErr;

    if (!state.is_completed || !state.updated_at) {
      from = new Date(now.getTime() - 15 * 60 * 1000);
    } else {
      from = new Date(state.updated_at);
    }

    // ограничение окна 60 минут
    if (to - from > 60 * 60 * 1000) {
      from = new Date(to.getTime() - 60 * 60 * 1000);
    }

    const EXTENSIONS = [
      94413, 94415, 145748, 349957, 349963, 351106, 469589,
      533987, 555997, 562946, 643886, 660848, 669428, 718843,
      765119, 768698, 775235, 775238, 805250, 809876, 813743,
      828290, 839939, 855176, 858926, 858929, 858932, 858935,
      911927, 946706, 968099, 969008, 982610, 995756, 1015712,
    ];

    const { access_token } = await getTelphinToken();

    for (const extensionId of EXTENSIONS) {
      let records;
      try {
        records = await fetchTelphinRecords(access_token, {
          extensionId,
          from,
          to,
        });
      } catch {
        continue;
      }

      for (const r of records) {
        const record_uuid = r.record_uuid || r.RecordUUID;
        if (!record_uuid) continue;

        const flow = r.flow || r.direction;
        const startedRaw = r.start_time_gmt || r.init_time_gmt;

        const fromNumber = r.ani_number || r.from_number || null;
        const toNumber = r.dest_number || r.to_number || null;

        const fromNorm = normalizePhone(fromNumber);
        const toNorm = normalizePhone(toNumber);
        const callDate = startedRaw ? new Date(startedRaw + 'Z') : null;

        await supabase.from('okk_calls_telphin_raw').upsert(
          {
            record_uuid,
            extension_id: r.extension_id || extensionId,
            client_id: r.client_id || null,
            rec_id: r.call_uuid || null,
            started_at: callDate ? callDate.toISOString() : null,
            duration_sec: r.duration || null,
            direction: flow || null,
            from_number: fromNorm,
            to_number: toNorm,
            call_status:
              r.result || r.call_status || r.hangup_cause || null,
            storage_url: r.storage_url || r.record_url || null,
            has_record: !!(r.storage_url || r.record_url),
            raw_payload: r,
          },
          { onConflict: 'record_uuid' }
        );

        if (r.storage_url || r.record_url) {
          await supabase.from('okk_calls_transcribe_queue').upsert(
            {
              id: record_uuid,
              status: 'pending',
              recording_url: r.storage_url || r.record_url,
              phone: flow === 'in' ? fromNorm : toNorm,
              from_number: fromNorm,
              to_number: toNorm,
              direction: flow,
              call_status:
                r.result || r.call_status || r.hangup_cause || null,
              call_started_at: callDate
                ? callDate.toISOString()
                : null,
              duration_sec: r.duration || null,
              extension_id: extensionId,
              raw_payload: r,
            },
            { onConflict: 'id' }
          );
        }

        total++;
      }
    }

    // --- фиксируем состояние ---
    await supabase
      .from('okk_sync_state')
      .update({
        is_completed: true,
        updated_at: to.toISOString(),
      })
      .eq('sync_type', 'telphin_calls');

    return res.status(200).json({
      status: 'ok',
      from: from.toISOString(),
      to: to.toISOString(),
      total,
    });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: String(e) });
  }
}
