//api/okk-sync-calls-telphin-all.js
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

// Те же параметры, что и в рабочем файле:
const TELPHIN_API_BASE = 'https://apiproxy.telphin.ru';
const TELPHIN_API_VERSION = '/api/ver1.0';

// Формат даты строго как в рабочем файле
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

// Нормализация телефона: оставляем только цифры и плюс
function normalizePhone(val) {
  if (!val) return null;
  return String(val).replace(/[^\d+]/g, '');
}

// OAuth — 100% копия твоего рабочего файла
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
    const text = await resp.text().catch(() => '');
    throw new Error(
      `Telphin OAuth error: ${resp.status} ${resp.statusText} ${text}`,
    );
  }

  return resp.json();
}

// Получение звонков по одному внутреннему номеру
async function fetchTelphinRecords(accessToken, { extensionId, from, to }) {
  const params = new URLSearchParams({
    start_datetime: formatTelphinDate(from),
    end_datetime: formatTelphinDate(to),
    order: 'asc',
  });

  const url = `${TELPHIN_API_BASE}${TELPHIN_API_VERSION}/extension/${extensionId}/record/?${params.toString()}`;

  const resp = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new Error(
      `Telphin record list error: ${resp.status} ${resp.statusText} ${text}`,
    );
  }

  return resp.json();
}

// Главный хендлер: тянем все extension
export default async function handler(req, res) {
  try {
    if (!TELPHIN_CLIENT_ID || !TELPHIN_CLIENT_SECRET) {
      return res.status(500).json({
        error: 'TELPHIN_ENV_NOT_SET',
        message: 'TELPHIN_CLIENT_ID / TELPHIN_CLIENT_SECRET not set',
      });
    }

    // Полный список внутренних номеров
    const EXTENSIONS = [
      94413, 94415, 145748, 349957, 349963, 351106, 469589,
      533987, 555997, 562946, 643886, 660848, 669428, 718843,
      765119, 768698, 775235, 775238, 805250, 809876, 813743,
      828290, 839939, 855176, 858926, 858929, 858932, 858935,
      911927, 946706, 968099, 969008, 982610, 995756, 1015712,
    ];

    const { access_token } = await getTelphinToken();

    const now = new Date();
    const from = new Date(now.getTime() - 24 * 60 * 60 * 1000);

    let total = 0;
    const perExt = [];

    for (const extensionId of EXTENSIONS) {
      try {
        const records = await fetchTelphinRecords(access_token, {
          extensionId,
          from,
          to: now,
        });

        if (!records || !records.length) {
          perExt.push({ extensionId, imported: 0 });
          continue;
        }

        const rows = records
          .map((r) => {
            const flow = r.flow || r.direction || null;

            // Определяем кто кому звонит
            let fromNumber = null;
            let toNumber = null;

            if (flow === 'out') {
              // исходящий: наш номер → клиент
              fromNumber =
                r.ani_number ||
                r.from_number ||
                r.from_username ||
                null;
              toNumber =
                r.dest_number ||
                r.to_number ||
                r.to_username ||
                null;
            } else if (flow === 'in') {
              // входящий: клиент → наш номер
              fromNumber =
                r.ani_number ||
                r.from_number ||
                r.from_username ||
                null;
              toNumber =
                r.dest_number ||
                r.to_number ||
                r.to_username ||
                null;
            } else {
              // запасной вариант
              fromNumber =
                r.from_number ||
                r.ani_number ||
                r.from_username ||
                null;
              toNumber =
                r.to_number ||
                r.dest_number ||
                r.to_username ||
                null;
            }

            const fromNorm = normalizePhone(fromNumber);
            const toNorm = normalizePhone(toNumber);

            const startedRaw = r.start_time_gmt || r.init_time_gmt;

            return {
              record_uuid: r.record_uuid || r.RecordUUID || null,
              extension_id: r.extension_id || r.ExtensionId || null,
              client_id: r.client_owner_id || r.client_id || null,
              rec_id: r.call_uuid || null,
              started_at: startedRaw
                ? new Date(startedRaw + 'Z').toISOString()
                : null,
              duration_sec: r.duration || null,
              direction: flow,
              from_number: fromNorm,
              to_number: toNorm,
              call_status:
                r.result || r.call_status || r.hangup_cause || null,
              storage_url: r.storage_url || r.record_url || null,
              has_record: !!(r.storage_url || r.record_url),
              raw_payload: r,
            };
          })
          .filter((x) => x.record_uuid);

        if (rows.length) {
          const { error } = await supabase
            .from('okk_calls_telphin_raw')
            .upsert(rows, { onConflict: 'record_uuid' });

          if (error) throw error;

          total += rows.length;
          perExt.push({ extensionId, imported: rows.length });
        } else {
          perExt.push({ extensionId, imported: 0 });
        }
      } catch (err) {
        perExt.push({
          extensionId,
          imported: 0,
          error: err.message,
        });
      }
    }

    return res.status(200).json({
      total_imported: total,
      extensions: perExt,
    });
  } catch (err) {
    console.error('okk-sync-calls-telphin-all FAILED:', err);
    return res.status(500).json({
      error: 'telphin_all_failed',
      message: err.message,
    });
  }
}
