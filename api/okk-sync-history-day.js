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

const PAGE_LIMIT = 100;

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Use GET' });
    return;
  }

  const dayParam = req.query.day; // YYYY-MM-DD
  const baseDate = dayParam ? new Date(dayParam) : new Date();

  const since = new Date(baseDate);
  since.setHours(0, 0, 0, 0);

  const until = new Date(baseDate);
  until.setHours(23, 59, 59, 999);

  let page = 1;
  let totalPages = 1;
  let inserted = 0;
  let skipped = 0;

  while (page <= totalPages) {
    const url =
      `${RETAILCRM_BASE_URL}/api/v5/orders/history` +
      `?apiKey=${encodeURIComponent(RETAILCRM_API_KEY)}` +
      `&page=${page}` +
      `&limit=${PAGE_LIMIT}`;

    const resp = await fetch(url);
    const data = await resp.json();

    if (!data.success) {
      res.status(500).json({ error: 'RetailCRM error', data });
      return;
    }

    totalPages = data.pagination?.totalPageCount || 1;

    for (const h of data.history || []) {
      if (!h.createdAt) {
        skipped += 1;
        continue;
      }

      const eventTime = new Date(h.createdAt);
      if (eventTime < since || eventTime > until) {
        skipped += 1;
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

      inserted += 1;
    }

    page += 1;
  }

  res.status(200).json({
    success: true,
    day: since.toISOString().slice(0, 10),
    inserted,
    skipped,
  });
}
