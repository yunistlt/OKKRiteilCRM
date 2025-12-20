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

const WINDOW_MINUTES = 10;
const MAX_WINDOWS = 200;
const EXT_BATCH = 5;

function formatTelphinDate(d) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(
    d.getHours()
  )}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

const normalize = (v) => (v ? String(v).replace(/[^\d+]/g, '') : null);

async function getTelphinToken() {
  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: TELPHIN_CLIENT_ID,
    client_secret: TELPHIN_CLIENT_SECRET,
    scope: 'all',
  });

  const r = await fetch(`${TELPHIN_API_BASE}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });

  const j = await r.json();
  if (!r.ok) throw new Error(JSON.stringify(j));
  return j.access_token;
}

async function fetchRecords(token, extensionId, from, to) {
  const q = new URLSearchParams({
    start_datetime: formatTelphinDate(from),
    end_datetime: formatTelphinDate(to),
    order: 'asc',
  });

  const r = await fetch(
    `${TELPHIN_API_BASE}${TELPHIN_API_VERSION}/extension/${extensionId}/record/?${q}`,
    { headers: { Authorization: `Bearer ${token}` } }
  );

  const j = await r.json();
  console.log('TELPHIN_RESPONSE', JSON.stringify(j));

  // ⬅️ КЛЮЧЕВОЕ ИСПРАВЛЕНИЕ
  if (Array.isArray(j)) return j;
  if (Array.isArray(j.items)) return j.items;

  console.log('TELPHIN_RAW_RESPONSE_KEYS', Object.keys(j || {}));
  return [];
}

export default async function handler(req, res) {
  const now = new Date();
  let total = 0;

  try {
    // принудительно последние 24 часа
    let from = new Date(now.getTime() - 24 * 60 * 60 * 1000);

    const EXTENSIONS = [
      94413, 94415, 145748, 349957, 349963, 351106, 469589,
      533987, 555997, 562946, 643886, 660848, 669428, 718843,
      765119, 768698, 775235, 775238, 805250, 809876, 813743,
      828290, 839939, 855176, 858926, 858929, 858932, 858935,
      911927, 946706, 968099, 969008, 982610, 995756, 1015712,
    ];

    const token = await getTelphinToken();

    for (let w = 0; w < MAX_WINDOWS; w++) {
      const to = new Date(from.getTime() + WINDOW_MINUTES * 60 * 1000);
      if (to > now) break;

      for (let i = 0; i < EXTENSIONS.length; i += EXT_BATCH) {
        const batch = EXTENSIONS.slice(i, i + EXT_BATCH);

        const results = await Promise.allSettled(
          batch.map((ext) => fetchRecords(token, ext, from, to))
        );

        for (let b = 0; b < results.length; b++) {
          if (results[b].status !== 'fulfilled') continue;

          const records = results[b].value;
          const extensionId = batch[b];

          for (const r of records) {
            const uuid = r.record_uuid || r.RecordUUID;
            if (!uuid) continue;

            const startedRaw = r.start_time_gmt || r.init_time_gmt;
            const started = startedRaw ? new Date(startedRaw + 'Z') : null;

            const fromN = normalize(r.ani_number || r.from_number);
            const toN = normalize(r.dest_number || r.to_number);

            await supabase.from('okk_calls_telphin_raw').upsert(
              {
                record_uuid: uuid,
                extension_id: r.extension_id || extensionId,
                client_id: r.client_id || null,
                rec_id: r.call_uuid || null,
                started_at: started ? started.toISOString() : null,
                duration_sec: r.duration || null,
                direction: r.flow || r.direction || null,
                from_number: fromN,
                to_number: toN,
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
                  id: uuid,
                  status: 'pending',
                  recording_url: r.storage_url || r.record_url,
                  phone:
                    (r.flow || r.direction) === 'in' ? fromN : toN,
                  from_number: fromN,
                  to_number: toN,
                  direction: r.flow || r.direction || null,
                  call_status:
                    r.result || r.call_status || r.hangup_cause || null,
                  call_started_at: started
                    ? started.toISOString()
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
      }

      from = to;
    }

    return res.status(200).json({ status: 'ok', total });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: String(e) });
  }
}
