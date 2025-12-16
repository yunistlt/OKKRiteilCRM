// api/okk-sync-history-day.js

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
const MAX_BATCHES = 5; // <= КЛЮЧ: ограничение на один вызов

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Use GET' });
    return;
  }

  const dayParam = req.query.day; // YYYY-MM-DD
  const baseDate = dayParam ? new Date(dayParam) : new Date();

  const sinceDate = new Date(baseDate);
  sinceDate.setHours(0, 0, 0, 0);

  const untilDate = new Date(baseDate);
  untilDate.setHours(23, 59, 59, 999);

  let sinceId = Number(req.query.sinceId || 0);
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
    if (history.length === 0) break;

    for (const h of history) {
      sinceId = Math.max(sinceId, h.id);

      if (!h.createdAt) {
        skipped++;
        continue;
      }

      const t = new Date(h.createdAt);
      if (t < sinceDate || t > untilDate) {
        skipped++;
        continue;
      }

      const row = {
        order_id: h.order?.id ?? null,
        retailcrm_order_id: h.order?.id ?? null,
        changed_at: h.createdAt,
        changer_retailcrm_user_id: h.user?.id ?? null,
        changer_id: null,
        change_type: h.source ?? null,
        field_name: h.field ?? null,
        old_value: h.oldValue ?? null,
        new_value: h.newValue ?? null,
        comment: h.comment ?? null,
        raw_payload: h,
        status_code: h.order?.status ?? null,
      };

      const { error } = await supabase
        .from('okk_order_history')
        .insert(row);

      if (error) {
        res.status(500).json({ error: 'DB insert error', details: error });
        return;
      }

      inserted++;
    }

    batches++;
  }

  res.status(200).json({
    success: true,
    day: sinceDate.toISOString().slice(0, 10),
    inserted,
    skipped,
    last_since_id: sinceId,
    batches,
  });
}
