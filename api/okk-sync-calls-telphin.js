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

// ВСЕ ВНУТРЕННИЕ НОМЕРА
const EXTENSIONS = [
  94413,94415,145748,349957,349963,351106,469589,
  533987,555997,562946,643886,660848,669428,718843,
  765119,768698,775235,775238,805250,809876,813743,
  828290,839939,855176,858926,858929,858932,858935,
  911927,946706,968099,969008,982610,995756,1015712,
];

const MAX_RANGE_HOURS = 24 * 30; // < 2 месяца

function fmt(d) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth()+1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}`;
}

async function getToken() {
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

async function fetchCalls(token, extensionId, from, to) {
  const q = new URLSearchParams({
    start_datetime: fmt(from),
    end_datetime: fmt(to),
    order: 'asc',
  });

  const r = await fetch(
    `${TELPHIN_API_BASE}${TELPHIN_API_VERSION}/extension/${extensionId}/record/?${q}`,
    { headers: { Authorization: `Bearer ${token}` } }
  );

  if (!r.ok) throw new Error(await r.text());
  return await r.json();
}

// 👉 ГЛАВНЫЙ АЛГОРИТМ
export default async function handler(req, res) {
  try {
    const token = await getToken();

    // 1. Узнаём, до какого момента уже скачали
    const { data: maxRow } = await supabase
      .from('okk_calls_telphin_raw')
      .select('started_at')
      .order('started_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    // если база пустая — стартуем с 18.12
    let from = maxRow?.started_at
      ? new Date(maxRow.started_at)
      : new Date('2025-12-18T00:00:00Z');

    let totalImported = 0;
    const now = new Date();

    while (from < now) {
      const to = new Date(
        Math.min(
          from.getTime() + MAX_RANGE_HOURS * 3600 * 1000,
          now.getTime(),
        ),
      );

      for (const extensionId of EXTENSIONS) {
        const records = await fetchCalls(token, extensionId, from, to);
        if (!Array.isArray(records) || !records.length) continue;

        const rows = records
          .filter((r) => r.record_uuid)
          .map((r) => ({
            record_uuid: r.record_uuid,
            extension_id: r.extension_id,
            client_id: r.client_owner_id ?? null,
            rec_id: r.call_uuid ?? null,
            started_at: r.start_time_gmt
              ? new Date(r.start_time_gmt + 'Z').toISOString()
              : null,
            duration_sec: typeof r.duration === 'number' ? r.duration : null,
            direction: r.flow ?? null,
            from_number: r.ani_number ?? null,
            to_number: r.dest_number ?? null,
            call_status: r.result ?? null,
            storage_url: r.storage_url ?? null,
            has_record: !!r.storage_url,
            raw_payload: r,
          }));

        if (rows.length) {
          const { error } = await supabase
            .from('okk_calls_telphin_raw')
            .upsert(rows, { onConflict: 'record_uuid' });

          if (error) throw error;
          totalImported += rows.length;
        }
      }

      from = new Date(to.getTime() + 1000); // сдвигаемся дальше
    }

    res.status(200).json({
      status: 'ok',
      imported: totalImported,
      up_to: now.toISOString(),
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
}
