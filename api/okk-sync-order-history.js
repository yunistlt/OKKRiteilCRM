// api/okk-sync-order-history.js

import { createClient } from '@supabase/supabase-js';
import { copyWorkingHistoryRows } from '../utils/workingHistory';

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
const MAX_PAGES_PER_RUN = 30;
const SYNC_KEY = 'order_history_since_id';

// --------- okk_sync_state ---------

async function loadSinceIdFromState() {
  const { data, error } = await supabase
    .from('okk_sync_state')
    .select('value')
    .eq('key', SYNC_KEY)
    .order('id', { ascending: false })
    .limit(1);

  if (error) return 0;
  if (!data || data.length === 0) return 0;

  const raw = data[0].value;
  const num = Number(raw);
  return Number.isFinite(num) ? num : 0;
}

async function saveSinceIdToState(lastSeenId) {
  await supabase.from('okk_sync_state').insert({
    key: SYNC_KEY,
    value: String(lastSeenId),
  });
}

// --------- last sinceId detection ---------

async function getLastSinceId() {
  const fromState = await loadSinceIdFromState();
  if (fromState > 0) return fromState;

  const { data, error } = await supabase
    .from('okk_order_history')
    .select('raw_payload')
    .order('id', { ascending: false })
    .limit(50);

  if (error || !data || !data.length) return 0;

  let maxId = 0;

  for (const row of data) {
    const raw = row.raw_payload;
    if (!raw) continue;

    const idStr = raw?.id ?? raw?.historyId ?? null;
    if (!idStr) continue;

    const parsed = parseInt(idStr, 10);
    if (!Number.isNaN(parsed) && parsed > maxId) maxId = parsed;
  }

  return maxId || 0;
}

// --------- RetailCRM history fetch ---------

async function fetchHistoryPage(sinceId) {
  const url = new URL('/api/v5/orders/history', RETAILCRM_BASE_URL);
  url.searchParams.set('apiKey', RETAILCRM_API_KEY);
  url.searchParams.set('limit', PAGE_LIMIT.toString());

  if (sinceId > 0) url.searchParams.set('filter[sinceId]', sinceId.toString());

  const resp = await fetch(url.toString());
  if (!resp.ok) throw new Error(`RetailCRM HTTP ${resp.status}`);

  const json = await resp.json();
  if (!json.success) throw new Error(`RetailCRM: ${json.error || 'unknown error'}`);

  return Array.isArray(json.history) ? json.history : [];
}

// --------- load orders mapping ---------

async function loadOrdersMap(retailOrderIds) {
  if (!retailOrderIds.length) return new Map();

  const { data, error } = await supabase
    .from('okk_orders')
    .select('id, retailcrm_order_id')
    .in('retailcrm_order_id', retailOrderIds);

  if (error) throw error;

  const map = new Map();
  for (const row of data || []) {
    map.set(Number(row.retailcrm_order_id), row.id);
  }
  return map;
}

function extractOrdersIdsFromHistory(history) {
  const ids = new Set();
  for (const h of history) {
    const orderId =
      h.order?.id ??
      h.order?.externalId ??
      h.order?.number ??
      h.orderId ??
      h.order_id ??
      null;

    if (orderId) ids.add(Number(orderId));
  }
  return [...ids];
}

// --------- map RetailCRM → DB rows ---------

function mapHistoryToRows(history, ordersMap) {
  const rows = [];

  for (const h of history) {
    const retailOrderId =
      h.order?.id ??
      h.order?.externalId ??
      h.order?.number ??
      h.orderId ??
      h.order_id ??
      null;

    if (!retailOrderId) continue;

    const orderId = ordersMap.get(Number(retailOrderId)) || null;

    const fieldName = h.fieldName || h.field || null;

    const oldValue =
      h.oldValue !== undefined ? JSON.stringify(h.oldValue) : null;
    const newValue =
      h.newValue !== undefined ? JSON.stringify(h.newValue) : null;

    const comment =
      h.comment ||
      h.statusComment ||
      (typeof h.newValue === 'object' && h.newValue?.comment) ||
      null;

    rows.push({
      order_id: orderId,
      retailcrm_order_id: Number(retailOrderId),
      changed_at: h.createdAt ? new Date(h.createdAt).toISOString() : null,
      changer_retailcrm_user_id: h.user?.id ?? null,
      changer_id: null,
      change_type: h.source || h.action || null,
      field_name: fieldName,
      old_value: oldValue,
      new_value: newValue,
      comment,
      raw_payload: h,
    });
  }

  return rows;
}

// --------- handler ---------

export default async function handler(req, res) {
  try {
    if (req.method !== 'GET') {
      res.status(405).json({ success: false, error: 'Method not allowed' });
      return;
    }

    if (!RETAILCRM_API_KEY || !RETAILCRM_BASE_URL || !SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      res.status(500).json({ success: false, error: 'Missing env variables' });
      return;
    }

    let sinceId = await getLastSinceId();
    const sinceIdStart = sinceId;
    let maxSeenId = sinceId;

    let totalInserted = 0;
    let totalPages = 0;

    while (totalPages < MAX_PAGES_PER_RUN) {
      const history = await fetchHistoryPage(sinceId);
      if (!history.length) break;

      totalPages++;

      for (const h of history) {
        if (typeof h.id === 'number' && h.id > maxSeenId) {
          maxSeenId = h.id;
        }
      }

      const retailOrderIds = extractOrdersIdsFromHistory(history);
      const ordersMap = await loadOrdersMap(retailOrderIds);

      const rows = mapHistoryToRows(history, ordersMap);

      if (rows.length) {
        const { error } = await supabase
          .from('okk_order_history')
          .insert(rows);

        if (error) throw error;

        totalInserted += rows.length;

        // ---- контрольный механизм: дублируем рабочие статусы ----
        try {
          await copyWorkingHistoryRows(supabase, rows);
        } catch (e) {
          console.error('copyWorkingHistoryRows error', e);
        }
      }

      sinceId = maxSeenId;

      if (history.length < PAGE_LIMIT) break;
    }

    if (maxSeenId > sinceIdStart) {
      await saveSinceIdToState(maxSeenId);
    }

    res.status(200).json({
      success: true,
      inserted: totalInserted,
      pages: totalPages,
      sinceIdStart,
      lastSeenId: maxSeenId,
    });
  } catch (err) {
    console.error('okk-sync-order-history error', err);
    res.status(500).json({
      success: false,
      error: err.message || String(err),
    });
  }
}
