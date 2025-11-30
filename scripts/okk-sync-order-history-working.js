// api/okk-sync-order-history-working.js
// Тянет историю из RetailCRM ТОЛЬКО по указанным заказам (рабочие статусы)
// и пишет её в okk_order_history_working.
// Добавлена расширенная диагностика RetailCRM 400.

import { createClient } from '@supabase/supabase-js';

const {
  RETAILCRM_API_KEY,
  RETAILCRM_BASE_URL,
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
} = process.env;

if (!RETAILCRM_API_KEY || !RETAILCRM_BASE_URL || !SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('[okk-sync-order-history-working] Missing required env vars');
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const HISTORY_LIMIT = 200;

// ---------------------------------------------------------
// Helpers
// ---------------------------------------------------------

function normalizeOrderIds(param) {
  if (!param) return [];

  const arr = Array.isArray(param) ? param : [param];
  const ids = new Set();

  for (const part of arr) {
    if (!part) continue;

    const pieces = String(part)
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);

    for (const p of pieces) {
      const num = parseInt(p, 10);
      if (Number.isFinite(num) && num > 0) ids.add(num);
    }
  }

  return [...ids];
}

// ---------------------------------------------------------
// Тянем историю из RetailCRM по одному orderId
// ---------------------------------------------------------

async function fetchHistoryFromRetail(orderId) {
  const url =
    `${RETAILCRM_BASE_URL}/api/v5/orders/history` +
    `?apiKey=${encodeURIComponent(RETAILCRM_API_KEY)}` +
    `&filter[orders][]=${encodeURIComponent(orderId)}` +
    `&limit=${HISTORY_LIMIT}`;

  const resp = await fetch(url);
  const text = await resp.text(); // важно — читаем тело полностью

  if (!resp.ok) {
    throw new Error(
      `[okk-sync-order-history-working] RetailCRM HTTP ${resp.status} (order ${orderId}): ${text.slice(0, 300)}`
    );
  }

  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(
      `[okk-sync-order-history-working] RetailCRM invalid JSON (order ${orderId}): ${text.slice(0, 300)}`
    );
  }

  if (!json.success) {
    throw new Error(
      `[okk-sync-order-history-working] RetailCRM logical error (order ${orderId}): ${json.errorMsg || json.error || text.slice(0,300)}`
    );
  }

  return Array.isArray(json.history) ? json.history : [];
}

// ---------------------------------------------------------

async function loadOrderDbId(retailOrderId) {
  const { data, error } = await supabase
    .from('okk_orders')
    .select('id')
    .eq('retailcrm_order_id', retailOrderId)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return data?.id || null;
}

function mapHistoryToRows(history, orderDbId, retailOrderId) {
  return history.map((h) => {
    const field = h.field || h.fieldName || null;

    let changeType = 'field_change';
    if (field === 'status') changeType = 'status_change';
    else if (field === 'manager') changeType = 'manager_change';
    else if (field === 'comment') changeType = 'comment_change';

    const changerUserId =
      h.user && (h.user.id || h.user.externalId || h.user.id_external);

    return {
      order_id: orderDbId,
      retailcrm_order_id: retailOrderId,
      changed_at: h.createdAt || h.createdAtIso || h.createdAtUtc || null,
      changer_retailcrm_user_id: changerUserId || null,
      changer_id: null,
      change_type: changeType,
      field_name: field,
      old_value: h.oldValue !== undefined ? JSON.stringify(h.oldValue) : null,
      new_value: h.newValue !== undefined ? JSON.stringify(h.newValue) : null,
      comment:
        h.comment ||
        h.statusComment ||
        (typeof h.newValue === 'object' && h.newValue?.comment) ||
        null,
      raw_payload: h,
    };
  });
}

// ---------------------------------------------------------
// Handler
// ---------------------------------------------------------

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res
      .status(405)
      .json({ success: false, error: 'Method not allowed' });
  }

  try {
    const orderIds = normalizeOrderIds(req.query.orderIds);

    if (!orderIds.length) {
      return res.status(400).json({
        success: false,
        error: 'Missing or invalid orderIds param',
      });
    }

    let totalInserted = 0;
    const perOrder = [];
    const errors = [];

    for (const retailOrderId of orderIds) {
      try {
        const orderDbId = await loadOrderDbId(retailOrderId);

        // 👉 Тянем историю из RetailCRM (здесь и вылетает 400)
        const history = await fetchHistoryFromRetail(retailOrderId);

        if (!history.length) {
          perOrder.push({
            retailcrm_order_id: retailOrderId,
            inserted: 0,
          });
          continue;
        }

        const rows = mapHistoryToRows(history, orderDbId, retailOrderId);

        if (rows.length) {
          const { error } = await supabase
            .from('okk_order_history_working')
            .insert(rows);

          if (error) throw error;

          totalInserted += rows.length;

          perOrder.push({
            retailcrm_order_id: retailOrderId,
            inserted: rows.length,
          });
        }
      } catch (e) {
        console.error(
          '[okk-sync-order-history-working] error on order',
          retailOrderId,
          e,
        );

        errors.push({
          retailcrm_order_id: retailOrderId,
          error: String(e.message || e),
        });
      }
    }

    return res.status(200).json({
      success: true,
      requested: orderIds.length,
      totalInserted,
      perOrder,
      errors,
    });
  } catch (err) {
    console.error('[okk-sync-order-history-working] fatal', err);
    return res.status(500).json({
      success: false,
      error: String(err.message || err),
    });
  }
}
