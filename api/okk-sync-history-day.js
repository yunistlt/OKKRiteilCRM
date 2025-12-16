// api/okk-sync-history-today.js

import { createClient } from '@supabase/supabase-js';

const {
  RETAILCRM_API_KEY,
  RETAILCRM_BASE_URL,
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
} = process.env;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const LIMIT = 100;
const MAX_BATCHES = 5;

const SYNC_TYPE = 'orders_history_today';

// RetailCRM createdAt часто приходит как "YYYY-MM-DD HH:MM:SS" без TZ.
// Чтобы стабильно резать "сегодня", парсим как UTC.
function parseRetailDateUtc(s) {
  if (!s || typeof s !== 'string') return null;
  const iso = s.includes('T') ? s : s.replace(' ', 'T');
  const withZ = iso.endsWith('Z') ? iso : `${iso}Z`;
  const d = new Date(withZ);
  return Number.isNaN(d.getTime()) ? null : d;
}

function yyyyMmDdUtc(d) {
  return d.toISOString().slice(0, 10);
}

function startOfTodayUtc() {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0, 0));
}

function endOfTodayUtc() {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 23, 59, 59, 999));
}

async function getStateRow() {
  const { data, error } = await supabase
    .from('okk_sync_state')
    .select('id,sync_type,last_page,is_completed')
    .eq('sync_type', SYNC_TYPE)
    .maybeSingle();

  if (error) throw error;

  // если строки нет — создаём (last_page=0, is_completed=false)
  if (!data) {
    const { data: created, error: createError } = await supabase
      .from('okk_sync_state')
      .insert({
        sync_type: SYNC_TYPE,
        last_page: 0,
        is_completed: false,
      })
      .select('id,sync_type,last_page,is_completed')
      .single();

    if (createError) throw createError;
    return created;
  }

  return data;
}

async function updateState({ id, last_page, is_completed }) {
  const payload = {};
  if (last_page !== undefined) payload.last_page = last_page;
  if (is_completed !== undefined) payload.is_completed = is_completed;

  const { error } = await supabase
    .from('okk_sync_state')
    .update(payload)
    .eq('id', id);

  if (error) throw error;
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Use GET' });
    return;
  }

  try {
    // день можно задать явно: ?day=YYYY-MM-DD
    const dayParam = req.query.day;
    const dayBase = dayParam ? new Date(dayParam) : new Date();

    const dayStart = new Date(Date.UTC(dayBase.getUTCFullYear(), dayBase.getUTCMonth(), dayBase.getUTCDate(), 0, 0, 0, 0));
    const dayEnd = new Date(Date.UTC(dayBase.getUTCFullYear(), dayBase.getUTCMonth(), dayBase.getUTCDate(), 23, 59, 59, 999));
    const dayStr = yyyyMmDdUtc(dayStart);

    // 1) состояние
    const state = await getStateRow();

    // Если сегодня новый день, просто сбрасываем флаг завершения.
    // last_page НЕ сбрасываем: он и есть курсор (sinceId) "докуда дошли".
    if (state.is_completed) {
      await updateState({ id: state.id, is_completed: false });
      state.is_completed = false;
    }

    let sinceId = Number(state.last_page || 0);
    if (!Number.isFinite(sinceId) || sinceId < 0) sinceId = 0;

    let inserted = 0;
    let skipped = 0;
    let batches = 0;

    while (batches < MAX_BATCHES) {
      const url =
        `${RETAILCRM_BASE_URL}/api/v5/orders/history` +
        `?apiKey=${encodeURIComponent(RETAILCRM_API_KEY)}` +
        `&filter[sinceId]=${sinceId}` +
        `&limit=${LIMIT}`;

      const resp = await fetch(url);
      const data = await resp.json();

      if (!data.success) {
        res.status(500).json({ error: 'RetailCRM error', data });
        return;
      }

      const history = data.history || []; 
      if (history.length === 0) {
        // истории дальше нет — считаем завершённым на текущий момент
        await updateState({ id: state.id, is_completed: true });
        state.is_completed = true;
        break;
      }

      const first = history[0];
const last = history[history.length - 1];

return res.status(200).json({
  debug: true,
  first_createdAt: first?.createdAt,
  last_createdAt: last?.createdAt,
  first_id: first?.id,
  last_id: last?.id,
});

      // максимум id в батче — новый курсор
      let maxId = sinceId;
      for (const h of history) {
        if (typeof h.id === 'number' && h.id > maxId) maxId = h.id;
      }

      // пишем только события выбранного дня
      const rows = [];
      for (const h of history) {
        const t = parseRetailDateUtc(h.createdAt);
        if (!t) {
          skipped += 1;
          continue;
        }

        if (t < dayStart || t > dayEnd) {
          skipped += 1;
          continue;
        }

        rows.push({
          order_id: h.order?.id ?? null,
          retailcrm_order_id: h.order?.id ?? null,
          changed_at: h.createdAt ?? null,
          changer_retailcrm_user_id: h.user?.id ?? null,
          changer_id: null,
          change_type: h.source ?? null,
          field_name: h.field ?? null,
          old_value: h.oldValue ?? null,
          new_value: h.newValue ?? null,
          comment: h.comment ?? null,
          raw_payload: h,
          status_code: h.order?.status ?? null,
        });
      }

      if (rows.length > 0) {
        const { error } = await supabase.from('okk_order_history').insert(rows);
        if (error) {
          res.status(500).json({ error: 'DB insert error', details: error });
          return;
        }
        inserted += rows.length;
      }

      // обновляем курсор в state
      sinceId = maxId;
      await updateState({ id: state.id, last_page: sinceId });

      batches += 1;

      // если уже пошли события позже выбранного дня — можно заканчивать быстрее
      // (значит "день" мы прошли полностью)
      const lastEventTime = parseRetailDateUtc(history[history.length - 1]?.createdAt);
      if (lastEventTime && lastEventTime > dayEnd) {
        await updateState({ id: state.id, is_completed: true });
        state.is_completed = true;
        break;
      }
    }

    res.status(200).json({
      success: true,
      sync_type: SYNC_TYPE,
      day: dayStr,
      inserted,
      skipped,
      last_since_id: sinceId,
      batches,
      is_completed: state.is_completed,
    });
  } catch (e) {
    res.status(500).json({ error: 'Unexpected error', details: String(e) });
  }
}
