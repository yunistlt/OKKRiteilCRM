// api/okk-sync-history-24h.js
// Берёт ТОЛЬКО события за последние 24 часа (без UTC-сдвига)

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
const SYNC_TYPE = 'orders_history_24h';

// ВАЖНО: парсим как ЛОКАЛЬНОЕ время CRM (БЕЗ Z)
function parseRetailLocal(s) {
  if (!s) return null;
  const d = new Date(s.replace(' ', 'T'));
  return isNaN(d) ? null : d;
}

async function getState() {
  const { data } = await supabase
    .from('okk_sync_state')
    .select('*')
    .eq('sync_type', SYNC_TYPE)
    .maybeSingle();

  if (data) return data;

  const { data: created } = await supabase
    .from('okk_sync_state')
    .insert({ sync_type: SYNC_TYPE, last_page: 0, is_completed: false })
    .select('*')
    .single();

  return created;
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end();

  const state = await getState();

  // INIT: поставить курсор на "сейчас", чтобы не листать старьё
  if (req.query.init === '1') {
    const r = await fetch(
      `${RETAILCRM_BASE_URL}/api/v5/orders/history?apiKey=${RETAILCRM_API_KEY}&limit=1`
    );
    const j = await r.json();
    const lastId = j.history?.[0]?.id || 0;

    await supabase
      .from('okk_sync_state')
      .update({ last_page: lastId, is_completed: false })
      .eq('id', state.id);

    return res.json({ init: true, last_page: lastId });
  }

  let sinceId = state.last_page;
  const now = new Date();
  const from24h = new Date(now.getTime() - 24 * 60 * 60 * 1000);

  let inserted = 0;
  let skipped = 0;
  let batches = 0;

  while (batches < MAX_BATCHES) {
    const r = await fetch(
      `${RETAILCRM_BASE_URL}/api/v5/orders/history` +
      `?apiKey=${RETAILCRM_API_KEY}&filter[sinceId]=${sinceId}&limit=${LIMIT}`
    );
    const j = await r.json();
    if (!j.success || !j.history?.length) break;

    let maxId = sinceId;
    const rows = [];

    for (const h of j.history) {
      if (h.id > maxId) maxId = h.id;

      const t = parseRetailLocal(h.createdAt);
      if (!t || t < from24h || t > now) {
        skipped++;
        continue;
      }

      rows.push({
        order_id: h.order?.id ?? null,
        retailcrm_order_id: h.order?.id ?? null,
        changed_at: h.createdAt,
        changer_retailcrm_user_id: h.user?.id ?? null,
        change_type: h.source ?? null,
        field_name: h.field ?? null,
        old_value: h.oldValue ?? null,
        new_value: h.newValue ?? null,
        comment: h.comment ?? null,
        raw_payload: h,
        status_code: h.order?.status ?? null,
      });
    }

    if (rows.length) {
      await supabase.from('okk_order_history').insert(rows);
      inserted += rows.length;
    }

    sinceId = maxId;
    await supabase
      .from('okk_sync_state')
      .update({ last_page: sinceId })
      .eq('id', state.id);

    batches++;
  }

  return res.json({
    success: true,
    inserted,
    skipped,
    last_since_id: sinceId,
    batches,
  });
}
