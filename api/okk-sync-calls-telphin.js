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

const EXTENSIONS = [
  94413,94415,145748,349957,349963,351106,469589,
  533987,555997,562946,643886,660848,669428,718843,
  765119,768698,775235,775238,805250,809876,813743,
  828290,839939,855176,858926,858929,858932,858935,
  911927,946706,968099,969008,982610,995756,1015712,
];

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

export default async function handler(req, res) {
  try {
    const idx = Number(req.query.i || 0);
    const extensionId = EXTENSIONS[idx];

    if (!extensionId) {
      return res.status(200).json({ status: 'done' });
    }

    const token = await getTelphinToken();

    const now = new Date();
    const from = new Date('2025-12-08T00:00:00Z');

    const records = await fetchRecords(token, extensionId, from, now);

    let imported = 0;

    for (const r of records) {
      const uuid = r.record_uuid || r.RecordUUID;
      if (!uuid) continue;

      const payload = {
        record_uuid: uuid,
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
      };

      const { data, error } = await supabase
        .from('okk_calls_telphin_raw')
        .upsert(payload, { onConflict: 'record_uuid' })
        .select('record_uuid');

      if (error) {
        console.error('UPSERT ERROR', error);
        continue;
      }

      if (data?.length) imported++;
    }

    return res.status(200).json({
      extensionId,
      imported,
      next: `/api/okk-sync-calls-telphin?i=${idx + 1}`,
    });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: String(e) });
  }
}
