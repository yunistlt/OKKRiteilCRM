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

async function fetchCalls(token, from, to, page = 1) {
  const q = new URLSearchParams({
    start_datetime: formatTelphinDate(from),
    end_datetime: formatTelphinDate(to),
    page: String(page),
    per_page: '100',
    order: 'asc',
  });

  const r = await fetch(
    `${TELPHIN_API_BASE}${TELPHIN_API_VERSION}/calls/?${q}`,
    { headers: { Authorization: `Bearer ${token}` } }
  );

  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

export default async function handler(req, res) {
  try {
    const page = Number(req.query.page || 1);

    const token = await getTelphinToken();

    const from = new Date('2025-12-08T00:00:00Z');
    const to   = new Date('2025-12-19T23:59:59Z');

    const result = await fetchCalls(token, from, to, page);
    const calls = Array.isArray(result?.data) ? result.data : [];

    let imported = 0;

    for (const c of calls) {
      const uuid = c.call_uuid || c.uuid;
      if (!uuid) continue;

      const payload = {
        call_uuid: uuid,
        extension_id: c.extension_id || null,
        started_at: c.start_time_gmt
          ? new Date(c.start_time_gmt + 'Z').toISOString()
          : null,
        duration_sec: c.duration || null,
        direction: c.flow || null,
        from_number: c.ani_number || null,
        to_number: c.dest_number || null,
        call_status: c.result || null,
        has_record: !!c.record_uuid,
        record_uuid: c.record_uuid || null,
        raw_payload: c,
      };

      const { error, data } = await supabase
        .from('okk_calls_telphin_raw')
        .upsert(payload, { onConflict: 'call_uuid' })
        .select('call_uuid');

      if (!error && data?.length) imported++;
    }

    const hasNext = calls.length === 100;

    return res.status(200).json({
      page,
      imported,
      next: hasNext ? `/api/okk-sync-calls-telphin?page=${page + 1}` : null,
    });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: String(e) });
  }
}
