// api/okk-sync-calls-telphin-all.js

import { createClient } from '@supabase/supabase-js';

const {
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
  TELPHIN_BASE_URL,
  TELPHIN_API_TOKEN,
} = process.env;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error('Missing Supabase env vars');
}
if (!TELPHIN_BASE_URL || !TELPHIN_API_TOKEN) {
  throw new Error('Missing Telphin env vars');
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

// ---------- helpers ----------

function formatDate(dt) {
  const pad = (n) => String(n).padStart(2, '0');
  const yyyy = dt.getUTCFullYear();
  const mm = pad(dt.getUTCMonth() + 1);
  const dd = pad(dt.getUTCDate());
  const hh = pad(dt.getUTCHours());
  const mi = pad(dt.getUTCMinutes());
  const ss = pad(dt.getUTCSeconds());
  // Формат, который ждёт Телфин: "YYYY-MM-DD HH:MM:SS"
  return `${yyyy}-${mm}-${dd} ${hh}:${mi}:${ss}`;
}

async function telphinRequest(path, params = {}) {
  const url = new URL(path, TELPHIN_BASE_URL);

  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null) {
      url.searchParams.set(k, String(v));
    }
  });

  const resp = await fetch(url.toString(), {
    headers: {
      Authorization: `Bearer ${TELPHIN_API_TOKEN}`,
      Accept: 'application/json',
    },
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new Error(
      `Telphin request error: ${resp.status} ${resp.statusText} ${text}`
    );
  }

  return resp.json();
}

async function fetchExtensions() {
  // Список всех внутренних номеров клиента
  // Ожидаем, что Телфин вернёт массив объектов (как ты прислал)
  const data = await telphinRequest('/client/@me/extension/');
  if (Array.isArray(data)) return data;

  // На всякий случай, если Телфин вернёт { items: [...] }
  if (Array.isArray(data.items)) return data.items;

  throw new Error('Unexpected Telphin extension list format');
}

async function fetchRecordsForExtension(extensionId, startDatetime, endDatetime) {
  // Записи разговоров по конкретному extension_id
  const data = await telphinRequest(`/extension/${extensionId}/record/`, {
    start_datetime: startDatetime,
    end_datetime: endDatetime,
    order: 'asc',
  });

  if (!Array.isArray(data)) {
    throw new Error(
      `Unexpected Telphin records format for extension ${extensionId}`
    );
  }

  return data;
}

function mapRecordsToRows(records) {
  return records.map((rec) => ({
    // id не задаём — генерится в БД как uuid
    record_uuid: rec.record_uuid || null,
    extension_id: rec.extension_id ?? null,
    client_id: rec.client_owner_id ?? null,
    rec_id: null,

    // берём init_time_gmt как старт звонка
    started_at: rec.init_time_gmt || null,

    duration_sec: rec.duration ?? null,

    // пока не заполняем, чтобы совпадать с текущими строками
    direction: null,
    from_number: null,
    to_number: null,
    call_status: null,

    storage_url: rec.storage_url || null,
    has_record: !!rec.storage_url,

    // сырое тело полностью
    raw_payload: JSON.stringify(rec),
  }));
}

// ---------- handler ----------

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'method_not_allowed' });
  }

  try {
    // Берём последние 24 часа
    const now = new Date();
    const from = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const startDatetime = formatDate(from);
    const endDatetime = formatDate(now);

    // 1. Получаем список внутренних номеров
    const allExtensions = await fetchExtensions();

    // Только активные телефоны
    const phoneExtensions = allExtensions.filter(
      (e) => e.type === 'phone' && e.status === 'active'
    );

    let totalImported = 0;
    const perExtension = [];

    for (const ext of phoneExtensions) {
      const extensionId = ext.id;

      let records;
      try {
        records = await fetchRecordsForExtension(
          extensionId,
          startDatetime,
          endDatetime
        );
      } catch (err) {
        // Не валим весь процесс, просто лог
        console.error(
          `Failed to fetch records for extension ${extensionId}:`,
          err.message
        );
        perExtension.push({
          extension_id: extensionId,
          imported: 0,
          error: err.message,
        });
        continue;
      }

      if (!records.length) {
        perExtension.push({
          extension_id: extensionId,
          imported: 0,
        });
        continue;
      }

      const rows = mapRecordsToRows(records);

      const { error } = await supabase
        .from('okk_calls_telphin_raw')
        .upsert(rows, { onConflict: 'record_uuid' });

      if (error) {
        console.error(
          `Supabase upsert error for extension ${extensionId}:`,
          error.message
        );
        perExtension.push({
          extension_id: extensionId,
          imported: 0,
          error: error.message,
        });
        continue;
      }

      totalImported += rows.length;
      perExtension.push({
        extension_id: extensionId,
        imported: rows.length,
      });
    }

    return res.status(200).json({
      imported_total: totalImported,
      start_datetime: startDatetime,
      end_datetime: endDatetime,
      extensions_checked: phoneExtensions.length,
      per_extension: perExtension,
    });
  } catch (err) {
    console.error('Telphin sync all failed:', err);
    return res.status(500).json({
      error: 'telphin_sync_all_failed',
      message: err.message,
    });
  }
}
