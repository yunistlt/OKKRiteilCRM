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

// Основной API-хост Телфина
const TELPHIN_API_BASE = 'https://apiproxy.telphin.ru';
const TELPHIN_API_VERSION = '/api/ver1.0';

// Формат даты как в примере SDK Телфина: "2006-01-02 15:04:05"
function formatTelphinDate(date) {
  const pad = (n) => String(n).padStart(2, '0');
  const y = date.getFullYear();
  const m = pad(date.getMonth() + 1);
  const d = pad(date.getDate());
  const hh = pad(date.getHours());
  const mm = pad(date.getMinutes());
  const ss = pad(date.getSeconds());
  return `${y}-${m}-${d} ${hh}:${mm}:${ss}`;
}

// Получаем access_token по OAuth2 (client_credentials / Trusted app)
async function getTelphinToken() {
  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: TELPHIN_CLIENT_ID,
    client_secret: TELPHIN_CLIENT_SECRET,
    // scope может отличаться, в доках Телфина обычно "call_api"
    scope: 'call_api',
  });

  const resp = await fetch(`${TELPHIN_API_BASE}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new Error(
      `Telphin OAuth error: ${resp.status} ${resp.statusText} ${text}`,
    );
  }

  return resp.json(); // { access_token, token_type, expires_in, scope, user: {...} }
}

// TODO: endpoint и поля нужно будет сверить в интерфейсе
// https://apiproxy.telphin.ru (client_api_explorer)
// Здесь я использую сигнатуру по мотивам Go-SDK Telphin (GetRecordList).
async function fetchTelphinRecords(accessToken, { extensionId, from, to }) {
  const params = new URLSearchParams({
    extension_id: String(extensionId),
    start_date: formatTelphinDate(from),
    end_date: formatTelphinDate(to),
    order: 'asc',
  });

  const url = `${TELPHIN_API_BASE}${TELPHIN_API_VERSION}/record/list?${params.toString()}`;

  const resp = await fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new Error(
      `Telphin record list error: ${resp.status} ${resp.statusText} ${text}`,
    );
  }

  // Ожидаем массив объектов RecordList (см. Telphin SDK)
  return resp.json();
}

// Простой хендлер: тянем записи за последние 24 часа по одному внутреннему номеру
export default async function handler(req, res) {
  try {
    if (!TELPHIN_CLIENT_ID || !TELPHIN_CLIENT_SECRET) {
      return res
        .status(500)
        .json({ error: 'TELPHIN_CLIENT_ID / TELPHIN_CLIENT_SECRET not set' });
    }

    // extensionId можно передавать через query: /api/okk-sync-calls-telphin?extensionId=101
    const { extensionId } = req.query;
    if (!extensionId) {
      return res.status(400).json({ error: 'extensionId is required' });
    }

    const { access_token } = await getTelphinToken();

    const now = new Date();
    const from = new Date(now.getTime() - 24 * 60 * 60 * 1000); // последние 24 часа

    const records = await fetchTelphinRecords(access_token, {
      extensionId,
      from,
      to: now,
    });

    if (!Array.isArray(records) || records.length === 0) {
      return res.status(200).json({ imported: 0 });
    }

    // Маппим в структуру нашей таблицы
    const rows = records.map((r) => ({
      record_uuid: r.RecordUUID || r.record_uuid || null,
      extension_id: r.ExtensionId || r.ExtensionID || r.extension_id || null,
      client_id: r.ClientId || r.ClientID || null,
      rec_id: r.RecID || r.rec_id || null,

      started_at:
        r.CreateDate || r.StartTime || r.start_time
          ? new Date(r.CreateDate || r.StartTime || r.start_time).toISOString()
          : null,

      duration_sec:
        typeof r.Duration === 'number'
          ? Math.round(r.Duration / 1_000_000) // если в микросекундах
          : r.DurationSec || r.duration_sec || null,

      direction: r.Direction || r.direction || null,
      from_number:
        r.CallerIDNum || r.caller_id_num || r.FromNumber || r.from_number || null,
      to_number:
        r.RemoteNumber ||
        r.remote_number ||
        r.CalledNumber ||
        r.called_number ||
        null,
      call_status: r.CallStatus || r.call_status || null,

      // URL до записи, если выдаёт API (часто отдельным методом)
      storage_url:
        r.StorageUrl || r.storage_url || r.RecordUrl || r.record_url || null,
      has_record: !!(r.RecordUUID || r.RecID || r.RecordUrl || r.StorageUrl),

      raw_payload: r,
    })).filter((row) => row.record_uuid); // без record_uuid не пишем

    if (!rows.length) {
      return res.status(200).json({ imported: 0, note: 'no record_uuid in payload' });
    }

    const { error } = await supabase
      .from('okk_calls_telphin_raw')
      .upsert(rows, { onConflict: 'record_uuid' });

    if (error) {
      throw error;
    }

    return res.status(200).json({ imported: rows.length });
  } catch (err) {
    console.error('okk-sync-calls-telphin error:', err);
    return res.status(500).json({
      error: 'telphin_sync_failed',
      message: err.message || String(err),
    });
  }
}
