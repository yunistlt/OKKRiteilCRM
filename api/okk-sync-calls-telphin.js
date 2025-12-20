// api/okk-sync-calls-telphin-auto.js
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
const MAX_EXTENSIONS_PER_RUN = 20; // защита от таймаута

function formatTelphinDate(date) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth()+1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
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

  if (!resp.ok) {
    throw new Error(`Telphin OAuth error ${resp.status}`);
  }

  return resp.json();
}

async function fetchRecords(accessToken, extensionId, from, to) {
  const params = new URLSearchParams({
    start_datetime: formatTelphinDate(from),
    end_datetime: formatTelphinDate(to),
    order: 'asc',
  });

  const url = `${TELPHIN_API_BASE}${TELPHIN_API_VERSION}/extension/${extensionId}/record/?${params}`;

  const resp = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!resp.ok) {
    throw new Error(`Telphin records error ${resp.status}`);
  }

  return resp.json();
}

export default async function handler(req, res) {
  try {
    const { data: extensions } = await supabase
      .from('okk_calls_telphin_raw')
      .select('extension_id')
      .not('extension_id', 'is', null)
      .limit(1000);

    const uniqueExtensions = [...new Set(extensions.map(e => e.extension_id))]
      .slice(0, MAX_EXTENSIONS_PER_RUN);

    if (!uniqueExtensions.length) {
      return res.status(200).json({ ok: true, imported: 0 });
    }

    const { access_token } = await getTelphinToken();
    const now = new Date();
    let totalImported = 0;

    for (const extensionId of uniqueExtensions) {
      const { data: last } = await supabase
        .from('okk_calls_telphin_raw')
        .select('started_at')
        .eq('extension_id', extensionId)
        .order('started_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      const from = last?.started_at
        ? new Date(last.started_at)
        : new Date(now.getTime() - 1000 * 60 * 60 * 24 * 30);

      const records = await fetchRecords(access_token, extensionId, from, now);
      if (!Array.isArray(records) || !records.length) continue;

      const rows = records
        .map(r => ({
          record_uuid: r.record_uuid,
          extension_id: extensionId,
          client_id: r.client_owner_id || null,
          started_at: r.init_time_gmt || r.start_time_gmt || null,
          duration_sec: r.duration || null,
          direction: r.flow || null,
          from_number: r.ani_number || null,
          to_number: r.dest_number || null,
          call_status: r.result || null,
          storage_url: r.storage_url || null,
          has_record: !!r.storage_url,
          raw_payload: r,
        }))
        .filter(r => r.record_uuid);

      if (!rows.length) continue;

      await supabase
        .from('okk_calls_telphin_raw')
        .upsert(rows, { onConflict: 'record_uuid' });

      totalImported += rows.length;
    }

    res.status(200).json({
      ok: true,
      imported: totalImported,
      extensions: uniqueExtensions.length,
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
}
