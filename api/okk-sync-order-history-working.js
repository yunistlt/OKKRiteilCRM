// api/okk-sync-order-history-working.js

import { createClient } from '@supabase/supabase-js';
import { copyWorkingHistoryRows } from '../utils/workingHistory';

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
  console.error('[okk-sync-order-history-working] Missing env vars');
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

// сколько записей истории тянем за один запрос к RetailCRM
const PAGE_LIMIT = 100;

// --------- helpers: карта заказов ---------

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

// --------- тянем историю по пачке orders ---------

async function fetchHistoryForOrders(orderIds) {
  if (!orderIds.length) return [];

  const all = [];
  let page = 1;

  while (true) {
    const url = new URL('/api/v5/orders/history', RETAILCRM_BASE_URL);
    url.searchParams.set('apiKey', RETAILCRM_API_KEY);
    url.searchParams.set('limit', PAGE_LIMIT.toString());
    url.searchParams.set('page', String(page));

    for (const id of orderIds) {
      url.searchParams.append('filter[orders][]', String(id));
    }

    const resp = await fetch(url.toString());
    if (!resp.ok) {
      throw new Error(
        `[okk-sync-order-history-working] RetailCRM HTTP ${resp.status}`,
      );
    }

    const json = await resp.json();
    if (!json.success) {
      throw new Error(
        `[okk-sync-order-history-working] RetailCRM error: ${
          json.error || json.errorMsg || 'unknown error'
        }`,
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

// --------- handler ---------

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  try {
    if (
      !RETAILCRM_API_KEY ||
      !RETAILCRM_BASE_URL ||
      !SUPABASE_URL ||
      !SUPABASE_SERVICE_ROLE_KEY
    ) {
      return res
        .status(500)
        .json({ success: false, error: 'Missing env variables' });
    }

    // orderIds можно передать как:
    // ?orderIds=50162,50163,50164
    // или ?orderIds=50162&orderIds=50163
    const { orderIds } = req.query;

    let rawList = [];

    if (Array.isArray(orderIds)) {
      for (const chunk of orderIds) {
        if (chunk != null) {
          rawList.push(...String(chunk).split(','));
        }
      }
    } else if (orderIds != null) {
      rawList = String(orderIds).split(',');
    }

    const ids = [
      ...new Set(
        rawList
          .map((s) => parseInt(String(s).trim(), 10))
          .filter((n) => Number.isFinite(n)),
      ),
    ];

    if (!ids.length) {
      return res.status(400).json({
        success: false,
        error: 'Pass ?orderIds=ID1,ID2,... (RetailCRM order IDs)',
      });
    }

    // ограничимся разумной пачкой, чтобы не упасть по таймауту
    const limitedIds = ids.slice(0, 50);

    // 1) тянем историю по этим заказам
    const history = await fetchHistoryForOrders(limitedIds);

    if (!history.length) {
      return res.status(200).json({
        success: true,
        processed_orders: limitedIds.length,
        history_records: 0,
        note: 'No history records for these orders',
      });
    }

    // 2) маппинг retailcrm_order_id -> okk_orders.id
    const retailOrderIds = extractOrdersIdsFromHistory(history);
    const ordersMap = await loadOrdersMap(retailOrderIds);

    // 3) готовим строки для okk_order_history
    const rows = mapHistoryToRows(history, ordersMap);

    // 4) чистим старую историю по этим заказам, чтобы не плодить дубли
    const { error: deleteError } = await supabase
      .from('okk_order_history')
      .delete()
      .in('retailcrm_order_id', limitedIds);

    if (deleteError) throw deleteError;

    // 5) вставляем новую историю
    let inserted = 0;
    if (rows.length) {
      const { error: insertError } = await supabase
        .from('okk_order_history')
        .insert(rows);

      if (insertError) throw insertError;

      inserted = rows.length;

      // дублируем рабочие статусы в служебную таблицу (как в общем синке)
      try {
        await copyWorkingHistoryRows(supabase, rows);
      } catch (e) {
        console.error(
          '[okk-sync-order-history-working] copyWorkingHistoryRows error',
          e,
        );
      }
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
