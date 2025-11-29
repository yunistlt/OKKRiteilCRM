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

// Заказы в рабочих статусах: okk_order_id + retailcrm_order_id
async function getWorkingOrders() {
  const statusCodes = await getWorkingStatusCodes();
  if (!statusCodes.length) return [];

  const { data, error } = await supabase
    .from('okk_orders')
    .select('id, retailcrm_order_id, current_status_code')
    .in('current_status_code', statusCodes);

  if (error) throw error;

  return (data || [])
    .filter((row) => Number.isFinite(Number(row.retailcrm_order_id)))
    .map((row) => ({
      okkOrderId: row.id,
      retailOrderId: Number(row.retailcrm_order_id),
    }));
}

// История по КОНКРЕТНОМУ заказу (RetailCRM order id + страница)
async function fetchHistoryPageForOrder(retailOrderId, page) {
  const url = new URL('/api/v5/orders/history', RETAILCRM_BASE_URL);
  url.searchParams.set('apiKey', RETAILCRM_API_KEY);
  url.searchParams.set('limit', String(PAGE_LIMIT));
  url.searchParams.set('page', String(page));
  // ключевой фильтр — только по одному заказу
  url.searchParams.set('filter[order]', String(retailOrderId));

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

// Маппим историю одного заказа в строки для okk_order_history
function mapHistoryToRowsForOrder(history, okkOrderId, retailOrderId) {
  const rows = [];

  for (const h of history) {
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
      order_id: okkOrderId,
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

    // 1) Берём только заказы в рабочих статусах
    const workingOrders = await getWorkingOrders();

    if (!workingOrders.length) {
      res.status(200).json({
        success: true,
        inserted: 0,
        pages: 0,
      });
      return;
    }

    let totalInserted = 0;
    let totalPages = 0;

    // 2) По каждому рабочему заказу тянем ВСЮ историю, но суммарно не более 10 страниц за запуск
    for (const order of workingOrders) {
      let page = 1;

      while (true) {
        if (totalPages >= MAX_PAGES_PER_RUN) break;

        const history = await fetchHistoryPageForOrder(
          order.retailOrderId,
          page
        );

        if (!history.length) break;

        totalPages += 1;

        const rows = mapHistoryToRowsForOrder(
          history,
          order.okkOrderId,
          order.retailOrderId
        );

        if (rows.length) {
          const { error } = await supabase
            .from('okk_order_history')
            .insert(rows);
          if (error) throw error;
          totalInserted += rows.length;
        }

        if (history.length < PAGE_LIMIT) {
          // для этого заказа история закончилась
          break;
        }

        page += 1;
      }

      if (totalPages >= MAX_PAGES_PER_RUN) break;
    }

    res.status(200).json({
      success: true,
      inserted: totalInserted,
      pages: totalPages,
    });
  } catch (err) {
    console.error('okk-sync-order-history error', err);
    res
      .status(500)
      .json({ success: false, error: err.message || String(err) });
  }
}
