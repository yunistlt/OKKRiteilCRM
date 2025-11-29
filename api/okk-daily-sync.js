// api/okk-daily-sync.js

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
const SYNC_KEY = 'orders_since_id';

// ==========================
// helpers for sync state
// ==========================

async function loadSinceIdFromState() {
  const { data, error } = await supabase
    .from('okk_sync_state')
    .select('value')
    .eq('key', SYNC_KEY)
    .order('id', { ascending: false })
    .limit(1);

  if (error) {
    console.error('loadSinceIdFromState error', error);
    return 0;
  }

  if (!data || data.length === 0) return 0;

  const raw = data[0]?.value;
  const num = Number(raw);
  return Number.isFinite(num) ? num : 0;
}

async function saveSinceIdToState(lastSeenId) {
  const { error } = await supabase.from('okk_sync_state').insert({
    key: SYNC_KEY,
    value: String(lastSeenId),
  });

  if (error) {
    console.error('saveSinceIdToState error', error);
  }
}

// если в sync_state ничего нет — берём максимум из уже загруженных заказов
async function getLastSinceId() {
  const fromState = await loadSinceIdFromState();
  if (fromState > 0) return fromState;

  const { data, error } = await supabase
    .from('okk_orders')
    .select('retailcrm_order_id')
    .order('retailcrm_order_id', { ascending: false })
    .limit(1);

  if (error) {
    console.error('getLastSinceId from okk_orders error', error);
    return 0;
  }

  if (!data || data.length === 0) return 0;

  const maxId = Number(data[0].retailcrm_order_id);
  return Number.isFinite(maxId) ? maxId : 0;
}

// ==========================
// managers map (okk_users)
// ==========================

async function loadManagersMap() {
  const { data, error } = await supabase
    .from('okk_users')
    .select('id, retailcrm_user_id');

  if (error) {
    console.error('loadManagersMap error', error);
    return new Map();
  }

  const map = new Map();
  for (const row of data || []) {
    if (row.retailcrm_user_id != null) {
      map.set(Number(row.retailcrm_user_id), row.id);
    }
  }
  return map;
}

// ==========================
// sync single order
// ==========================

async function syncSingleOrder(order, managersMap) {
  const managerRetailId =
    order.manager?.id || order.manager?.externalId || null;

  const managerId =
    managerRetailId != null
      ? managersMap.get(Number(managerRetailId)) || null
      : null;

  const paid =
    typeof order.paid === 'boolean'
      ? order.paid
      : order.paymentStatus === 'paid' || order.paymentStatus === 'complete';

  const payloadOrder = {
    retailcrm_order_id: order.id,
    number: order.number || String(order.id),
    created_at_crm: order.createdAt || null,
    status_updated_at_crm:
      order.statusUpdatedAt || order.updatedAt || order.createdAt || null,
    current_status: order.status || null,
    current_status_code: order.status || null,
    summ: typeof order.summ === 'number' ? order.summ : null,
    purchase_summ:
      typeof order.purchaseSumm === 'number' ? order.purchaseSumm : null,
    // margin оставляем null, будем тянуть отдельно из ЦУ
    margin: null,
    manager_retailcrm_id: managerRetailId || null,
    manager_id: managerId,
    paid,
    payment_type: order.payments?.[0]?.type || null,
    shipped: !!order.shipped,
    delivery_type:
      order.delivery?.code || order.delivery?.service?.code || null,
    customer_type: order.customer?.type || null,
    custom_fields: order.customFields || {},
    items: order.items || [],
    last_synced_at: new Date().toISOString(),
  };

  const { data, error } = await supabase
    .from('okk_orders')
    .upsert(payloadOrder, { onConflict: 'retailcrm_order_id' })
    .select('id')
    .single();

  if (error) {
    console.error('syncSingleOrder upsert error', error, { orderId: order.id });
    throw error;
  }

  return data?.id || null;
}

// ==========================
// fetch page from RetailCRM
// ==========================

async function fetchOrdersPage(sinceId) {
  const url = new URL('/api/v5/orders', RETAILCRM_BASE_URL);
  url.searchParams.set('apiKey', RETAILCRM_API_KEY);
  url.searchParams.set('limit', String(PAGE_LIMIT));
  if (sinceId > 0) {
    url.searchParams.set('filter[sinceId]', String(sinceId));
  }

  const resp = await fetch(url.toString());
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(
      `RetailCRM orders HTTP ${resp.status}: ${text.slice(0, 300)}`
    );
  }

  const json = await resp.json();
  if (!json.success) {
    throw new Error(
      `RetailCRM orders error: ${json.error || 'unknown error'}`
    );
  }

  const orders = Array.isArray(json.orders) ? json.orders : [];
  return orders;
}

// ==========================
// handler
// ==========================

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

    const managersMap = await loadManagersMap();

    let sinceId = await getLastSinceId();
    const sinceIdStart = sinceId;
    let maxSeenId = sinceId;
    let totalSynced = 0;
    let totalPages = 0;

    while (true) {
      const orders = await fetchOrdersPage(sinceId);
      if (!orders.length) break;

      totalPages += 1;

      for (const order of orders) {
        const oid = Number(order.id);
        if (Number.isFinite(oid) && oid > maxSeenId) {
          maxSeenId = oid;
        }

        try {
          await syncSingleOrder(order, managersMap);
          totalSynced += 1;
        } catch (err) {
          // логируем, но не падаем на одной ошибке
          console.error('syncSingleOrder error', err, {
            retailcrm_order_id: order.id,
          });
        }
      }

      sinceId = maxSeenId;

      if (orders.length < PAGE_LIMIT) {
        // дошли до конца
        break;
      }
    }

    if (maxSeenId > sinceIdStart) {
      await saveSinceIdToState(maxSeenId);
    }

    res.status(200).json({
      success: true,
      synced: totalSynced,
      pages: totalPages,
      sinceIdStart,
      lastSeenId: maxSeenId,
    });
  } catch (e) {
    console.error('okk-daily-sync error', e);
    res.status(500).json({ success: false, error: e.message });
  }
}
