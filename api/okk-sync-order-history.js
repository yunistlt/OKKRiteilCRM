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
const MAX_PAGES_PER_RUN = 10; // не больше 10 страниц истории за один запуск
const CUTOFF_CREATED_AT = '2021-01-01 00:00:00'; // не сохраняем события старше этой даты

// Коды рабочих статусов из okk_sla_status
async function getWorkingStatusCodes() {
  const { data, error } = await supabase
    .from('okk_sla_status')
    .select('status_code')
    .eq('is_active', true)
    .eq('is_controlled', true);

  if (error) throw error;
  return (data || []).map((row) => row.status_code).filter(Boolean);
}

// Берём последний id истории прямо из okk_order_history (history.id из raw_payload)
async function getLastSinceId() {
  const { data, error } = await supabase
    .from('okk_order_history')
    .select('raw_payload')
    .order('id', { ascending: false })
    .limit(100);

  if (error) throw error;
  if (!data || data.length === 0) return 0;

  let maxId = 0;

  for (const row of data) {
    if (!row.raw_payload) continue;
    const raw = row.raw_payload;
    const idStr = raw?.id ?? raw?.historyId ?? null;
    if (!idStr) continue;

    const parsed = parseInt(idStr, 10);
    if (!Number.isNaN(parsed) && parsed > maxId) {
      maxId = parsed;
    }
  }

  return maxId || 0;
}

// Тянем ОДНУ страницу общей истории по sinceId
async function fetchHistoryPage(sinceId) {
  const url = new URL('/api/v5/orders/history', RETAILCRM_BASE_URL);
  url.searchParams.set('apiKey', RETAILCRM_API_KEY);
  url.searchParams.set('limit', String(PAGE_LIMIT));

  // единственный допустимый фильтр — sinceId
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

// Загружаем карту заказов ТОЛЬКО в рабочих статусах
async function loadOrdersMap(retailOrderIds) {
  if (!retailOrderIds.length) return new Map();

  const statusCodes = await getWorkingStatusCodes();
  if (!statusCodes.length) return new Map();

  const { data, error } = await supabase
    .from('okk_orders')
    .select('id, retailcrm_order_id')
    .in('retailcrm_order_id', retailOrderIds)
    .in('current_status_code', statusCodes);

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
  return Array.from(ids);
}

function mapHistoryToRows(history, ordersMap) {
  const rows = [];

  for (const h of history) {
    // игнорируем события до 01.01.2021
    if (h.createdAt && h.createdAt < CUTOFF_CREATED_AT) {
      continue;
    }

    const retailOrderId =
      h.order?.id ??
      h.order?.externalId ??
      h.order?.number ??
      h.orderId ??
      h.order_id ??
      null;

    if (!retailOrderId) continue;

    const orderId = ordersMap.get(Number(retailOrderId)) || null;
    if (!orderId) continue; // не в рабочей воронке — пропускаем

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
      changer_id: null,
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

    let sinceId = await getLastSinceId();
    const sinceIdStart = sinceId;
    let maxSeenId = sinceId;
    let totalInserted = 0;
    let totalPages = 0;

    // крутимся, но не больше 10 страниц за запуск
    while (totalPages < MAX_PAGES_PER_RUN) {
      const history = await fetchHistoryPage(sinceId);
      if (!history.length) break;

      totalPages += 1;

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
      }

      sinceId = maxSeenId;
      if (history.length < PAGE_LIMIT) break;
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
    res
      .status(500)
      .json({ success: false, error: err.message || String(err) });
  }
}
