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

// -----------------------------------------------------
// helper
// -----------------------------------------------------
function formatDate(date) {
  return date.toISOString().slice(0, 19).replace('T', ' ');
}

// -----------------------------------------------------
// sync 1 order + write history
// -----------------------------------------------------
async function syncSingleOrder(order) {
  const managerRetailId =
    order.manager?.id || order.manager?.externalId || null;

  let managerId = null;
  if (managerRetailId) {
    const { data: managerData } = await supabase
      .from('okk_managers')
      .select('id')
      .eq('retailcrm_user_id', managerRetailId)
      .maybeSingle();

    managerId = managerData?.id || null;
  }

  const paid =
    typeof order.paid === 'boolean'
      ? order.paid
      : order.paymentStatus === 'paid' ||
        order.paymentStatus === 'complete';

  const payloadOrder = {
    retailcrm_order_id: order.id,
    number: order.number || String(order.id),
    created_at_crm: order.createdAt,
    status_updated_at_crm:
      order.statusUpdatedAt || order.updatedAt || order.createdAt,
    current_status: order.status,
    current_status_code: order.status,
    summ: typeof order.summ === 'number' ? order.summ : null,
    purchase_summ:
      typeof order.purchaseSumm === 'number' ? order.purchaseSumm : null,
    manager_retailcrm_id: managerRetailId,
    manager_id: managerId,
    paid,
    payment_type: order.payments?.[0]?.type || null,
    shipped: !!order.shipped,
    delivery_type:
      order.delivery?.code || order.delivery?.service?.code || null,
    custom_fields: order.customFields || {},
    items: order.items || [],
  };

  const { data: okkOrder } = await supabase
    .from('okk_orders')
    .upsert(payloadOrder, { onConflict: 'retailcrm_order_id' })
    .select('id')
    .single();

  const okkOrderId = okkOrder.id;

  // HISTORY по конкретному заказу
  const histUrl =
    `${RETAILCRM_BASE_URL}/api/v5/orders/history` +
    `?apiKey=${encodeURIComponent(RETAILCRM_API_KEY)}` +
    `&filter[orderNumber]=${encodeURIComponent(order.number || String(order.id))}` +
    `&limit=200`;

  const hr = await fetch(histUrl);
  const hjson = await hr.json();

  const rows = (hjson.history || []).map((h) => ({
    okk_order_id: okkOrderId,
    retailcrm_order_id: order.id,
    created_at_crm: h.createdAt,
    new_status: h.newValue?.status || null,
    old_status: h.oldValue?.status || null,
    raw: h,
  }));

  if (rows.length > 0) {
    await supabase
      .from('okk_order_history')
      .upsert(rows, { onConflict: 'okk_order_id,created_at_crm' });
  }
}

// -----------------------------------------------------
// MAIN
// -----------------------------------------------------
export default async function handler(req, res) {
  try {
    if (req.method !== 'GET') {
      res
        .status(405)
        .json({ success: false, error: 'Method not allowed' });
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

    // controlled statuses
    const { data: statuses } = await supabase
      .from('okk_sla_status')
      .select('status_code')
      .eq('is_controlled', true);

    const statusCodes = (statuses || []).map((s) => s.status_code);

    const statusQuery = statusCodes
      .map((c) => `filter[extendedStatus][]=${encodeURIComponent(c)}`)
      .join('&');

    let page = 1;
    let totalPages = 1;
    let totalOrders = 0;
    let synced = 0;

    do {
      const url =
        `${RETAILCRM_BASE_URL}/api/v5/orders` +
        `?apiKey=${encodeURIComponent(RETAILCRM_API_KEY)}` +
        (statusQuery ? `&${statusQuery}` : '') +
        `&limit=100` +
        `&page=${page}`;

      const r = await fetch(url);
      if (!r.ok) {
        const text = await r.text();
        throw new Error(
          `RetailCRM orders HTTP ${r.status}: ${text.slice(0, 300)}`
        );
      }

      const json = await r.json();
      if (!json.success) {
        throw new Error(
          `RetailCRM orders error: ${json.error || 'unknown error'}`
        );
      }

      totalPages = json.pagination?.totalPageCount || 1;
      totalOrders = json.pagination?.totalCount || 0;

      for (const order of json.orders || []) {
        try {
          await syncSingleOrder(order);
          synced++;
        } catch (e) {
          console.error('syncSingleOrder error', e);
        }
      }

      page++;
    } while (page <= totalPages);

    res.status(200).json({
      success: true,
      synced,
      totalOrders,
      totalPages,
    });
  } catch (e) {
    console.error('okk-daily-sync error', e);
    res.status(500).json({ success: false, error: e.message });
  }
}
