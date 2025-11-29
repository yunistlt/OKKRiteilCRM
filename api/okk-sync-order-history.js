// api/okk-sync-order-history.js
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
const MAX_PAGES_PER_RUN = 20; // максимум 2000 событий на один запуск на одну пачку заказов

// Получаем коды рабочих статусов из okk_sla_status
async function getWorkingStatusCodes() {
  const { data, error } = await supabase
    .from('okk_sla_status')
    .select('status_code')
    .eq('is_active', true)
    .eq('is_controlled', true);

  if (error) throw error;
  return (data || []).map((row) => row.status_code).filter(Boolean);
}

// Получаем retailcrm_order_id заказов в рабочих статусах
async function getWorkingRetailOrderIds() {
  const statusCodes = await getWorkingStatusCodes();
  if (!statusCodes.length) return [];

  const { data, error } = await supabase
    .from('okk_orders')
    .select('retailcrm_order_id')
    .in('current_status_code', statusCodes);

  if (error) throw error;

  return (data || [])
    .map((row) => Number(row.retailcrm_order_id))
    .filter((id) => Number.isFinite(id));
}

async function fetchHistoryPage(sinceId) {
  const url = new URL('/api/v5/orders/history', RETAILCRM_BASE_URL);
  url.searchParams.set('apiKey', RETAILCRM_API_KEY);
  url.searchParams.set('limit', String(PAGE_LIMIT));
  if (sinceId > 0) {
    url.searchParams.set('filter[sinceId]', String(sinceId));
  }

  const resp = await fetch(url.toString());
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(
      `RetailCRM history HTTP ${resp.status}: ${text.slice(0, 300)}`
    );
  }

  const json = await resp.json();
  if (!json.success) {
    throw new Error(
      `RetailCRM history error: ${json.error || 'unknown error'}`
    );
  }

  return Array.isArray(json.history) ? json.history : [];
}
  const json = await resp.json();
  if (!json.success) {
    throw new Error(
      `RetailCRM history error: ${json.error || 'unknown error'}`
    );
  }

  const history = Array.isArray(json.history) ? json.history : [];
  return history;
}

async function loadOrdersMap(retailOrderIds) {
  if (!retailOrderIds.length) return new Map();

  const { data, error } = await supabase
    .from('okk_orders')
    .select('id, retailcrm_order_id')
    .in('retailcrm_order_id', retailOrderIds);

  if (error) throw error;

  const map = new Map();
  for (const row of (data || [])) {
    map.set(Number(row.retailcrm_order_id), row.id);
  }
  return map;
}

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
    if (!orderId) continue;

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

    const row = {
      order_id: orderId,
      retailcrm_order_id: Number(retailOrderId),
      changed_at: h.createdAt ? new Date(h.createdAt).toISOString() : null,
      changer_retailcrm_user_id: h.user?.id ?? null,
      changer_id: null, // потом свяжем с okk_users
      change_type: h.source || h.action || null,
      field_name: fieldName,
      old_value: oldValue,
      new_value: newValue,
      comment,
      raw_payload: h,
    };

    rows.push(row);
  }

  return rows;
}

export default async function handler(req, res) {
  try {
    if (req.method !== 'GET') {
      res.status(405).json({ success: false, error: 'Method not allowed' });
      return;
    }

    if (
      !RETAILCRM_API_KEY ||
      !RETAILCRM_BASE_URL ||
      !SUPABASE_URL ||
      !SUPABASE_SERVICE_ROLE_KEY
    ) {
      res.status(500).json({
        success: false,
        error: 'Missing required environment variables',
      });
      return;
    }

    // Берём только заказы в рабочих статусах
    const workingRetailIds = await getWorkingRetailOrderIds();
    if (!workingRetailIds.length) {
      res.status(200).json({
        success: true,
        inserted: 0,
        pages: 0,
        sinceIdStart: 0,
        lastSeenId: 0,
      });
      return;
    }

    const chunkSize = 50;
    let totalInserted = 0;
    let totalPages = 0;

    for (let i = 0; i < workingRetailIds.length; i += chunkSize) {
      const chunk = workingRetailIds.slice(i, i + chunkSize);

      // Загружаем историю по этой пачке заказов по всем страницам
      for (let page = 1; page <= MAX_PAGES_PER_RUN; page++) {
        const history = await fetchHistoryPage(chunk, page);
        if (!history.length) break;

        totalPages += 1;

        const ordersMap = await loadOrdersMap(chunk);
        const rows = mapHistoryToRows(history, ordersMap);

        if (rows.length) {
          const { error } = await supabase
            .from('okk_order_history')
            .insert(rows);
          if (error) throw error;
          totalInserted += rows.length;
        }

        if (history.length < PAGE_LIMIT) break;
      }
    }

    res.status(200).json({
      success: true,
      inserted: totalInserted,
      pages: totalPages,
      sinceIdStart: 0,
      lastSeenId: 0,
    });
  } catch (err) {
    console.error('okk-sync-order-history error', err);
    res
      .status(500)
      .json({ success: false, error: err.message || String(err) });
  }
}
