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

const BASE_URL = 'https://apiproxy.telphin.ru';
const API_VER = '/api/ver1.0';
const PAGE_LIMIT = 100;
const MAX_PAGES = 50;

function formatTelphinDate(date) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth()+1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

async function getLastCallTime() {
  const { data } = await supabase
    .from('okk_calls_telphin_raw')
    .select('started_at')
    .order('started_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  return data?.started_at ? new Date(data.started_at) : new Date(Date.now() - 1000*60*60*24*30);
}

async function fetchCalls(fromDate, page) {
  const url = `${BASE_URL}${API_VER}/statistic/calls/cdr?from=${formatTelphinDate(fromDate)}&limit=${PAGE_LIMIT}&page=${page}`;
  const res = await fetch(url, {
    headers: {
      Authorization:
        'Basic ' +
        Buffer.from(`${TELPHIN_CLIENT_ID}:${TELPHIN_CLIENT_SECRET}`).toString('base64'),
    },
  });
  if (!res.ok) throw new Error(`Telphin error ${res.status}`);
  return res.json();
}

export default async function handler(req, res) {
  try {
    const fromDate = await getLastCallTime();

    for (let page = 1; page <= MAX_PAGES; page++) {
      const rows = await fetchCalls(fromDate, page);
      if (!rows?.length) break;

      const payload = rows.map((r) => ({
        record_uuid: r.record_uuid,
        rec_id: r.call_uuid,
        extension_id: r.extension_id,
        client_id: r.client_owner_id,
        started_at: r.start_time_gmt,
        duration_sec: r.duration,
        direction: r.flow,
        from_number: r.ani_number,
        to_number: r.dest_number,
        call_status: r.result,
        storage_url: r.storage_url,
        has_record: !!r.storage_url,
        raw_payload: JSON.stringify(r),
      }));

      await supabase
        .from('okk_calls_telphin_raw')
        .upsert(payload, { onConflict: 'record_uuid' });
    }

    res.status(200).json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
