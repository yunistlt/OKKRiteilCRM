// api/okk-sync-order-history-working.js

import { createClient } from '@supabase/supabase-js';

const {
  RETAILCRM_API_KEY,
  RETAILCRM_BASE_URL,
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
} = process.env;

if (
  !RETAILCRM_API_KEY ||
  !RETAILCRM_BASE_URL ||
  !SUPABASE_URL ||
  !SUPABASE_SERVICE_ROLE_KEY
) {
  console.error('[okk-sync-order-history-working] Missing env variables');
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const PAGE_LIMIT = 100;

// -----------------------------------------------------------
// helpers
// -----------------------------------------------------------

function extractOrderId(historyItem) {
  return (
    historyItem.order?.id ??
    historyItem.order?.externalId ??
    historyItem.order?.number ??
    historyItem.orderId ??
    historyItem.order_id ??
    null
  );
}

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

function mapHistoryToRows(history, ordersMap) {
  const rows = [];

  for (const h of history) {
    const retailId = extractOrderId(h);
    if (!retailId) continue;

    const orderId = ordersMap.get(Number(retailId)) || null;

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
      retailcrm_order_id: Number(retailId),
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

async function fetchHistoryForOrders(orderIds) {
  const all = [];
  let page = 1;

  while (true) {
    const url = new URL('/api/v5/orders/history', RETAILCRM_BASE_URL);
    url.searchParams.set('apiKey', RETAILCRM_API_KEY);
    url.searchParams.set('limit', String(PAGE_LIMIT));
    url.searchParams.set('page', String(page));

    for (const id of orderIds) {
      url.searchParams.append('filter[orders][]', String(id));
    }

    const resp = await fetch(url.toString());
    if (!resp.ok) {
      throw new Error(
        `[okk-sync-order-history-working] RetailCRM HTTP ${resp.status}`
      );
    }

    const json = await resp.json();
    if (!json.success) {
      throw new Error(
        `[okk-sync-order-history-working] RetailCRM error: ${
          json.error || json.errorMsg || 'unknown'
        }`
      );
    }

    const part = Array.isArray(json.history) ? json.history : [];
    if (!part.length) break;

    all.push(...part);

    if (part.length < PAGE_LIMIT) break;
    page += 1;
  }

  return all;
}

// -----------------------------------------------------------
// handler
// -----------------------------------------------------------

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  try {
    const { orderIds } = req.query;
    let rawList = [];

    if (Array.isArray(orderIds)) {
      for (const chunk of orderIds) {
        rawList.push(...String(chunk).split(','));
      }
    } else if (orderIds != null) {
      rawList = String(orderIds).split(',');
    }

    const ids = [
      ...new Set(
        rawList
          .map((s) => parseInt(String(s).trim(), 10))
          .filter((n) => Number.isFinite(n))
      ),
    ];

    if (!ids.length) {
      return res.status(400).json({
        success: false,
        error: 'Pass ?orderIds=ID1,ID2,...',
      });
    }

    const limitedIds = ids.slice(0, 50);

    // 1) тянем историю у RetailCRM
    const history = await fetchHistoryForOrders(limitedIds);

    if (!history.length) {
      return res.status(200).json({
        success: true,
        processed_orders: limitedIds.length,
        history_records: 0,
        note: 'No history records for these orders',
      });
    }

    // 2) маппинг retailcrm -> okk_orders.id
    const retailOrderIds = [...new Set(history.map(h => extractOrderId(h)).filter(Boolean))];
    const ordersMap = await loadOrdersMap(retailOrderIds);

    // 3) подготавливаем строки
    const rows = mapHistoryToRows(history, ordersMap);

    // 4) очищаем только нашу рабочую таблицу
    const { error: deleteError } = await supabase
      .from('okk_order_history_working')
      .delete()
      .in('retailcrm_order_id', limitedIds);

    if (deleteError) throw deleteError;

    // 5) вставляем новую историю
    let inserted = 0;

    if (rows.length) {
      const { error: insertError } = await supabase
        .from('okk_order_history_working')
        .insert(rows);

      if (insertError) throw insertError;

      inserted = rows.length;
    }

    return res.status(200).json({
      success: true,
      processed_orders: limitedIds.length,
      history_records: inserted,
    });
  } catch (err) {
    console.error('[okk-sync-order-history-working] fatal', err);
    return res.status(500).json({
      success: false,
      error: String(err.message || err),
    });
  }
}
