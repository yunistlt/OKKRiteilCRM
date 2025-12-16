// api/retailcrm-sync-history.js

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
const MAX_PAGES = 50;
const SYNC_KEY = 'retailcrm_last_history_id';

// ---------- helpers ----------

async function getLastHistoryId() {
  const { data } = await supabase
    .from('okk_sync_state')
    .select('value')
    .eq('key', SYNC_KEY)
    .single();

  return data?.value ? Number(data.value) : 0;
}

async function saveLastHistoryId(id) {
  await supabase.from('okk_sync_state').upsert(
    { key: SYNC_KEY, value: String(id) },
    { onConflict: 'key' }
  );
}

// ---------- main ----------

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'GET only' });
  }

  let sinceId = await getLastHistoryId();
  let page = 1;
  let maxSeenId = sinceId;
  let inserted = 0;

  try {
    while (page <= MAX_PAGES) {
      const url =
        `${RETAILCRM_BASE_URL}/api/v5/orders/history` +
        `?apiKey=${RETAILCRM_API_KEY}` +
        `&sinceId=${sinceId}` +
        `&limit=${PAGE_LIMIT}`;

      const r = await fetch(url);
      const j = await r.json();

      if (!j.success || !j.history?.length) break;

      const rows = j.history.map((h) => {
        maxSeenId = Math.max(maxSeenId, h.id);

        return {
          retailcrm_history_id: h.id,
          retailcrm_order_id: h.order?.id || null,
          changer_retailcrm_user_id: h.user?.id || null,
          field_name: h.field || null,
          old_value: h.oldValue ? JSON.stringify(h.oldValue) : null,
          new_value: h.newValue ? JSON.stringify(h.newValue) : null,
          changed_at: h.createdAt,
          raw_payload: h,
        };
      });

      const { error } = await supabase
        .from('okk_order_history')
        .insert(rows, { ignoreDuplicates: true });

      if (error) throw error;

      inserted += rows.length;
      sinceId = maxSeenId;
      page++;
    }

    if (maxSeenId > 0) {
      await saveLastHistoryId(maxSeenId);
    }

    res.json({
      success: true,
      inserted,
      last_history_id: maxSeenId,
      pages: page - 1,
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: String(e) });
  }
}
