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

// Получаем access_token по OAuth2 (trusted app → client_credentials)
async function getTelphinToken() {
  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: TELPHIN_CLIENT_ID,
    client_secret: TELPHIN_CLIENT_SECRET,
    // в доке для public-приложения scope=all — оставляем так же
    scope: 'all',
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

  return resp.json(); // { access_token, token_type, expires_in, scope, ... }
}

// Получение списка записей разговоров по ВНУТРЕННЕМУ номеру (extension_id)
// Документация: GET /extension/{extension_id}/record/
async function fetchTelphinRecords(accessToken, { extensionId, from, to }) {
  const params = new URLSearchParams({
    start_datetime: formatTelphinDate(from),
    end_datetime: formatTelphinDate(to),
    order: 'asc', // или desc, если нужно
  });

  const url = `${TELPHIN_API_BASE}${TELPHIN_API_VERSION}/extension/${extensionId}/record/?${params.toString()}`;

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

  // ожидаем массив записей
  return resp.json();
}

// Простой хендлер: тянем записи за последние 24 часа по одному внутреннему номеру
export default async function handler(req, res) {
  try {
    if (!TELPHIN_CLIENT_ID || !TELPHIN_CLIENT_SECRET) {
      return res.status(500).json({
        error: 'TELPHIN_ENV_NOT_SET',
        message: 'TELPHIN_CLIENT_ID / TELPHIN_CLIENT_SECRET not set',
      });
    }

    // extensionId можно передавать через query:
    // /api/okk-sync-calls-telphin?extensionId=301
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

    // Маппим в структуру нашей таблицы (на будущее оставляем гибко, по именам из разных версий)
    const rows = records
      .map((r) => ({
        record_uuid: r.record_uuid || r.RecordUUID || r.record_id || null,
        extension_id:
          r.extension_id || r.ExtensionId || r.ExtensionID || null,
        client_id: r.client_id || r.ClientId || r.ClientID || null,

        // время начала разговора
        started_at: (r.init_time_gmt || r.create_date || r.CreateDate)
          ? new Date(
              r.init_time_gmt || r.create_date || r.CreateDate,
            ).toISOString()
          : null,

        // длительность (пока просто duration, потом уточним по реальным данным)
        duration_sec:
          r.duration_sec ||
          r.DurationSec ||
          (typeof r.duration === 'number' ? r.duration : null),

        direction: r.direction || r.Direction || null,
        from_number:
          r.from_number ||
          r.FromNumber ||
          r.caller_id_num ||
          r.CallerIDNum ||
          null,
        to_number:
          r.to_number ||
          r.ToNumber ||
          r.remote_number ||
          r.RemoteNumber ||
          null,
        call_status: r.call_status || r.CallStatus || null,

        // URL до файла записи (если есть)
        storage_url:
          r.record_url ||
          r.RecordUrl ||
          r.storage_url ||
          r.StorageUrl ||
          null,

        has_record: !!(
          r.record_uuid ||
          r.RecordUUID ||
          r.record_url ||
          r.RecordUrl
        ),

        raw_payload: r,
      }))
      // без record_uuid в базу не пишем
      .filter((row) => row.record_uuid);

    if (!rows.length) {
      return res
        .status(200)
        .json({ imported: 0, note: 'no record_uuid in payload' });
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
