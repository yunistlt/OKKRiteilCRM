// api/okk-sync-calls-telphin.js

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

// ВСЕ внутренние номера
const EXTENSIONS = [
  94413,94415,145748,349957,349963,351106,469589,
  533987,555997,562946,643886,660848,669428,718843,
  765119,768698,775235,775238,805250,809876,813743,
  828290,839939,855176,858926,858929,858932,858935,
  911927,946706,968099,969008,982610,995756,1015712,
];

const START_FROM = new Date('2024-12-18T00:00:00Z');
const CHUNK_HOURS = 24 * 30; // 30 дней (безопасно для Telphin)

// ---------- utils ----------

function formatTelphinDate(d) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

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

  if (!r.ok) throw new Error(await r.text());
  return (await r.json()).access_token;
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

  if (!r.ok) throw new Error(await r.text());
  const j = await r.json();
  return Array.isArray(j) ? j : [];
}

async function getLastStartedAt(extensionId) {
  const { data } = await supabase
    .from('okk_calls_telphin_raw')
    .select('started_at')
    .eq('extension_id', extensionId)
    .order('started_at', { ascending: false })
    .limit(1);

  return data?.[0]?.started_at
    ? new Date(data[0].started_at)
    : null;
}

// ---------- handler ----------

export default async function handler(req, res) {
  try {
    const token = await getTelphinToken();
    const now = new Date();

    let totalImported = 0;

    for (const extensionId of EXTENSIONS) {
      let from =
        (await getLastStartedAt(extensionId)) || START_FROM;

      while (from < now) {
        const to = new Date(
          Math.min(
            from.getTime() + CHUNK_HOURS * 60 * 60 * 1000,
            now.getTime()
          )
        );

        const records = await fetchRecords(token, extensionId, from, to);

        if (records.length) {
          const rows = records
            .map((r) => ({
              record_uuid: r.record_uuid || r.RecordUUID,
              extension_id: extensionId,
              started_at: r.init_time_gmt
                ? new Date(r.init_time_gmt + 'Z').toISOString()
                : null,
              duration_sec: r.duration || null,
              direction: r.direction || r.flow || null,
              from_number: r.from_number || r.ani_number || null,
              to_number: r.to_number || r.dest_number || null,
              storage_url: r.record_url || r.storage_url || null,
              has_record: !!(r.record_url || r.storage_url),
              raw_payload: r,
            }))
            .filter(r => r.record_uuid);

          if (rows.length) {
            const { error } = await supabase
              .from('okk_calls_telphin_raw')
              .upsert(rows, { onConflict: 'record_uuid' });

            if (error) throw error;

            totalImported += rows.length;
          }
        }

        from = to;
      }
    }

    return res.status(200).json({
      status: 'ok',
      imported: totalImported,
      now: now.toISOString(),
    });
  } catch (err) {
  console.error('TELPHIN ERROR:', err);

  return res.status(500).json({
    error: err.message || String(err),
    raw: JSON.stringify(err, Object.getOwnPropertyNames(err)),
  });
}
}
