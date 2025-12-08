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

function normalizePhone(raw) {
  if (!raw) return null;
  let s = String(raw).trim();
  // убираем всё, кроме цифр и +
  s = s.replace(/[^0-9+]/g, '');
  // убираем ведущий +
  if (s.startsWith('+')) s = s.slice(1);
  // если 11 цифр и начинается с 8 — меняем на 7 (РФ)
  if (s.length === 11 && s.startsWith('8')) {
    s = '7' + s.slice(1);
  }
  // если 10 цифр — добавим 7
  if (s.length === 10) {
    s = '7' + s;
  }
  return s || null;
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
    const txt = await resp.text().catch(() => '');
    throw new Error(`Telphin token error: ${resp.status} ${txt}`);
  }

  const data = await resp.json();
  if (!data.access_token) {
    throw new Error('Telphin token error: no access_token');
  }

  return data.access_token;
}

async function fetchTelphinRecords({ accessToken, extensionId, dateFrom, dateTo }) {
  const params = new URLSearchParams({
    extension: String(extensionId),
    date_from: formatTelphinDate(dateFrom),
    date_to: formatTelphinDate(dateTo),
    withRecords: 'true',
  });

  const url = `${TELPHIN_API_BASE}${TELPHIN_API_VERSION}/statistics/records?${params.toString()}`;

  const resp = await fetch(url, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/json',
    },
  });

  if (!resp.ok) {
    const txt = await resp.text().catch(() => '');
    throw new Error(`Telphin records error: ${resp.status} ${txt}`);
  }

  const data = await resp.json();
  // Telphin обычно возвращает массив
  return Array.isArray(data) ? data : data.data || [];
}

export default async function handler(req, res) {
  try {
    if (!TELPHIN_CLIENT_ID || !TELPHIN_CLIENT_SECRET) {
      return res.status(500).json({
        error: 'TELPHIN_ENV_NOT_SET',
        message: 'TELPHIN_CLIENT_ID / TELPHIN_CLIENT_SECRET not set',
      });
    }

    const { extensionId, from, to } = req.query;
    if (!extensionId) {
      return res.status(400).json({ error: 'extensionId is required' });
    }

    // период: по умолчанию последние 24 часа
    const now = new Date();
    const dateTo = to ? new Date(to) : now;
    const dateFrom = from
      ? new Date(from)
      : new Date(now.getTime() - 24 * 60 * 60 * 1000);

    const accessToken = await getTelphinToken();
    const records = await fetchTelphinRecords({
      accessToken,
      extensionId,
      dateFrom,
      dateTo,
    });

    if (!records.length) {
      return res.status(200).json({
        imported_raw: 0,
        queued_for_transcribe: 0,
      });
    }

    let importedRaw = 0;
    let queued = 0;

    for (const r of records) {
      const recordUuid = r.record_uuid || r.RecordUUID;
      if (!recordUuid) continue;

      const flow = r.flow || r.direction || null;

      // from / to
      let fromNumber = null;
      let toNumber = null;

      if (flow === 'out') {
        fromNumber = r.ani_number || r.from_number;
        toNumber = r.dest_number || r.to_number;
      } else if (flow === 'in') {
        fromNumber = r.ani_number || r.from_number;
        toNumber = r.from_number || r.to_number || r.dest_number;
      } else {
        // fallback, если вдруг flow не определён
        fromNumber = r.ani_number || r.from_number || null;
        toNumber = r.dest_number || r.to_number || null;
      }

      const fromNorm = normalizePhone(fromNumber);
      const toNorm = normalizePhone(toNumber);

      const startRaw = r.start_time_gmt || r.init_time_gmt || r.started_at;
      const callDate = startRaw ? new Date(`${startRaw}Z`) : null;

      const storageUrl =
        r.storage_url || r.record_url || r.StorageUrl || r.RecordUrl || null;

      //
      // 1) okk_calls_telphin_raw — полный дамп
      //
      const { error: rawError } = await supabase
        .from('okk_calls_telphin_raw')
        .upsert(
          {
            record_uuid: recordUuid,
            extension_id: r.extension_id || extensionId,
            client_id: r.client_id || null,
            rec_id: r.call_uuid || null,
            started_at: callDate ? callDate.toISOString() : null,
            duration_sec: r.duration || null,
            direction: flow,
            from_number: fromNorm,
            to_number: toNorm,
            call_status:
              r.result || r.call_status || r.hangup_cause || r.callStatus || null,
            storage_url: storageUrl,
            has_record: !!storageUrl,
            raw_payload: r,
          },
          { onConflict: 'record_uuid' },
        );

      if (rawError) {
        console.error('upsert okk_calls_telphin_raw error:', rawError);
        continue;
      }

      importedRaw += 1;

      //
      // 2) okk_calls_transcribe_queue — очередь на транскрибацию
      //
      if (storageUrl) {
        const phone =
          flow === 'in'
            ? fromNorm || toNorm || null
            : toNorm || fromNorm || null;

        const { error: qError } = await supabase
          .from('okk_calls_transcribe_queue')
          .upsert(
            {
              id: recordUuid,
              status: 'pending',
              recording_url: storageUrl,
              phone,
              direction: flow,
              call_started_at: callDate ? callDate.toISOString() : null,
              duration_sec: r.duration || null,
              extension_id: r.extension_id || extensionId,
              raw_payload: r,
            },
            { onConflict: 'id' },
          );

        if (qError) {
          console.error(
            'upsert okk_calls_transcribe_queue error:',
            qError,
          );
        } else {
          queued += 1;
        }
      }
    }

    return res.status(200).json({
      imported_raw: importedRaw,
      queued_for_transcribe: queued,
    });
  } catch (err) {
    console.error('okk-sync-calls-telphin error:', err);
    return res
      .status(500)
      .json({ error: String(err.message || err) });
  }
}
