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
const MAX_PAGES_PER_RUN = 50;
// вместо sinceId теперь храним "до какой даты истории дошли"
const SYNC_KEY = 'order_history_date_to';

// --------- optional workingHistory helper ---------

let copyWorkingHistoryRows = null;

async function ensureWorkingHistoryUtilLoaded() {
  if (copyWorkingHistoryRows) return;

  try {
    const mod = await import('../utils/workingHistory.js');
    if (typeof mod.copyWorkingHistoryRows === 'function') {
      copyWorkingHistoryRows = mod.copyWorkingHistoryRows;
    } else {
      console.warn(
        'copyWorkingHistoryRows not found in ../utils/workingHistory.js, skipping working history copy'
      );
    }
  } catch (err) {
    console.warn(
      'utils/workingHistory.js not available, working history copy will be skipped',
      err
    );
  }
}

// --------- okk_sync_state: работа с датой ---------

async function loadDateToFromState() {
  const { data, error } = await supabase
    .from('okk_sync_state')
    .select('value')
    .eq('key', SYNC_KEY)
    .order('id', { ascending: false })
    .limit(1);

  if (error) {
    console.warn('loadDateToFromState error', error);
    return null;
  }
  if (!data || data.length === 0) return null;

  const raw = data[0].value;
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return null;

  return d;
}

async function saveDateToState(dateTo) {
  const iso = dateTo.toISOString();
  const { error } = await supabase.from('okk_sync_state').insert({
    key: SYNC_KEY,
    value: iso,
  });
  if (error) {
    console.warn('saveDateToState error', error);
  }
}

// --------- формат даты для RetailCRM (Y-m-d H:i:s) ---------

function formatRetailDateTime(date) {
  const pad = (n) => String(n).padStart(2, '0');

  const year = date.getFullYear();
  const month = pad(date.getMonth() + 1);
  const day = pad(date.getDate());
  const hours = pad(date.getHours());
  const minutes = pad(date.getMinutes());
  const seconds = pad(date.getSeconds());

  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
}

// --------- расчёт окна дат: идём от "to" на месяц назад ---------

function getDateWindow(dateTo) {
  const to = new Date(dateTo.getTime());
  const from = new Date(dateTo.getTime());
  // шаг – один месяц назад
  from.setMonth(from.getMonth() - 1);

  return { from, to };
}

// --------- fetch RetailCRM history по окну дат и странице ---------

async function fetchHistoryPageByDateRange({ from, to, page }) {
  const url = new URL('/api/v5/orders/history', RETAILCRM_BASE_URL);
  url.searchParams.set('apiKey', RETAILCRM_API_KEY);
  url.searchParams.set('limit', PAGE_LIMIT.toString());
  url.searchParams.set('page', page.toString());

  if (from) {
    url.searchParams.set('filter[startDate]', formatRetailDateTime(from));
  }
  if (to) {
    url.searchParams.set('filter[endDate]', formatRetailDateTime(to));
  }

  const resp = await fetch(url.toString());
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(
      `RetailCRM history HTTP ${resp.status}: ${text.slice(0, 200)}`
    );
  }

  const json = await resp.json();
  if (!json.success) {
    throw new Error(json.error || 'RetailCRM unknown error');
  }

  return Array.isArray(json.history) ? json.history : [];
}

// --------- orders map ---------

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
    const id =
      h.order?.id ??
      h.order?.externalId ??
      h.order?.number ??
      h.orderId ??
      h.order_id ??
      null;

    if (id) ids.add(Number(id));
  }

  return [...ids];
}

// --------- map CRM history → db rows ---------

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

    const dbOrderId = ordersMap.get(Number(retailOrderId)) || null;

    const fieldName = h.fieldName || h.field || null;

    rows.push({
      order_id: dbOrderId,
      retailcrm_order_id: Number(retailOrderId),
      changed_at: h.createdAt ? new Date(h.createdAt).toISOString() : null,
      changer_retailcrm_user_id: h.user?.id ?? null,
      changer_id: null,
      change_type: h.source || h.action || null,

      field_name: fieldName,
      old_value: h.oldValue !== undefined ? JSON.stringify(h.oldValue) : null,
      new_value: h.newValue !== undefined ? JSON.stringify(h.newValue) : null,

      comment:
        h.comment ||
        h.statusComment ||
        (typeof h.newValue === 'object' && h.newValue?.comment) ||
        null,

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

    await ensureWorkingHistoryUtilLoaded();

    // 1) Берём "до какой даты" мы уже дошли; если нет — стартуем с сегодняшнего дня
    let dateTo = await loadDateToFromState();
    if (!dateTo) {
      dateTo = new Date(); // первый запуск – от сегодняшнего дня
    }

    const { from: dateFrom, to: dateWindowTo } = getDateWindow(dateTo);

    let totalInserted = 0;
    let totalPages = 0;

    // 2) Грузим историю по окну дат, постранично
    for (let page = 1; page <= MAX_PAGES_PER_RUN; page++) {
      const history = await fetchHistoryPageByDateRange({
        from: dateFrom,
        to: dateWindowTo,
        page,
      });

      if (!history.length) break;

      totalPages++;

      const retailOrderIds = extractOrdersIdsFromHistory(history);
      const ordersMap = await loadOrdersMap(retailOrderIds);

      const rows = mapHistoryToRows(history, ordersMap);

      if (rows.length) {
        const { error } = await supabase.from('okk_order_history').insert(rows);
        if (error) throw error;

        totalInserted += rows.length;

        if (copyWorkingHistoryRows) {
          try {
            await copyWorkingHistoryRows(supabase, rows);
          } catch (err) {
            console.error('copyWorkingHistoryRows error', err);
          }
        }
      }

      if (history.length < PAGE_LIMIT) break;
    }

    // 3) Сдвигаем окно назад: следующий запуск пойдёт ещё на месяц глубже
    await saveDateToState(dateFrom);

    res.status(200).json({
      success: true,
      inserted: totalInserted,
      pages: totalPages,
      window: {
        from: formatRetailDateTime(dateFrom),
        to: formatRetailDateTime(dateWindowTo),
      },
    });
  } catch (err) {
    console.error('okk-sync-order-history error', err);
    res.status(500).json({
      success: false,
      error: err.message || String(err),
    });
  }
}
