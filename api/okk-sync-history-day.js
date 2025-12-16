// api/okk-sync-history-last10.js

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

export default async function handler(req, res) {
  const url =
    `${RETAILCRM_BASE_URL}/api/v5/orders/history` +
    `?apiKey=${encodeURIComponent(RETAILCRM_API_KEY)}` +
    `&limit=50`;

  const r = await fetch(url);
  const j = await r.json();

  if (!j.success) {
    return res.status(500).json(j);
  }

  const rows = j.history.map(h => ({
    order_id: h.order?.id ?? null,
    retailcrm_order_id: h.order?.id ?? null,
    changed_at: h.createdAt ?? null,
    changer_retailcrm_user_id: h.user?.id ?? null,
    change_type: h.source ?? null,
    field_name: h.field ?? null,
    old_value: h.oldValue ?? null,
    new_value: h.newValue ?? null,
    comment: h.comment ?? null,
    raw_payload: h,
    status_code: h.order?.status ?? null,
  }));

  await supabase.from('okk_order_history').insert(rows);

  res.json({
    success: true,
    inserted: rows.length,
    events: rows.map(r => r.changed_at),
  });
}
