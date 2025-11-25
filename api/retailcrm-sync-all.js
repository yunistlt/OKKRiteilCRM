import { createClient } from '@supabase/supabase-js';

const {
  RETAILCRM_API_KEY,
  RETAILCRM_BASE_URL,
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
} = process.env;

if (!RETAILCRM_API_KEY || !RETAILCRM_BASE_URL || !SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Missing required environment variables for retailcrm-sync-all function');
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const MAX_PAGES = 3;      // защита от бесконечных прогонов
const PAGE_LIMIT = 50;    // сколько заказов тянуть за раз

function formatDateTimeForRetailCRM(date) {
  // "YYYY-MM-DD HH:MM:SS"
  const iso = date.toISOString().slice(0, 19).replace('T', ' ');
  return iso;
}

async function syncSingleOrderFromObject(order) {
  // --- 1) Менеджер в okk_users ---
  let managerId = null;
  const managerRetailId =
    order.managerId ||
    (order.manager && (order.manager.id || order.manager.externalId));

  if (managerRetailId) {
    const managerFullName =
      (order.manager &&
        `${order.manager.firstName || ''} ${order.manager.lastName || ''}`.trim()) ||
      `User ${managerRetailId}`;

    const { data: userRow, error: userError } = await supabase
      .from('okk_users')
      .upsert(
        {
          retailcrm_user_id: managerRetailId,
          full_name: managerFullName,
          role: 'manager',
        },
        { onConflict: 'retailcrm_user_id' },
      )
      .select('id')
      .single();

    if (userError) {
      console.error('okk_users upsert error:', userError);
    } else if (userRow) {
      managerId = userRow.id;
    }
  }

  // --- 2) Заказ в okk_orders ---
  const summ = order.totalSumm ?? order.summ ?? 0;
  const purchaseSumm = order.purchaseSumm ?? 0;

  const paid =
    !!order.paid ||
    !!order.fullPaidAt ||
    (Array.isArray(order.payments) &&
      order.payments.some((p) => p.status === 'paid'));

  const paymentType =
    (Array.isArray(order.payments) && order.payments[0] && order.payments[0].type) ||
    order.paymentType ||
    null;

  const deliveryType =
    order.delivery && (order.delivery.code || (order.delivery.service && order.delivery.service.code));

  const customerType =
    order.orderType || (order.customer && order.customer.type) || null;

  const customFields = order.customFields || {};

  const payloadOrder = {
    retailcrm_order_id: order.id,
    number: order.number || String(order.id),

    created_at_crm: order.createdAt,
    status_updated_at_crm: order.statusUpdatedAt || order.updatedAt || order.createdAt,
    current_status: order.status,

    summ,
    purchase_summ: purchaseSumm,

    manager_retailcrm_id: managerRetailId || null,
    manager_id: managerId,

    paid,
    payment_type: paymentType,
    shipped: !!order.shipped,
    delivery_type: deliveryType,

    customer_type: customerType,
    production_due_date: customFields.production_due_date || null,
    production_start_date: customFields.production_start_date || null,

    custom_fields: customFields,
    items: order.items || [],
  };

  const { data: orderRow, error: orderError } = await supabase
    .from('okk_orders')
    .upsert(payloadOrder, { onConflict: 'retailcrm_order_id' })
    .select('id, retailcrm_order_id')
    .single();

  if (orderError) {
    console.error('okk_orders upsert error:', orderError);
    throw orderError;
  }

  // --- 3) История в okk_order_history ---
  const historyUrl =
    `${RETAILCRM_BASE_URL}/api/v5/orders/history` +
    `?apiKey=${encodeURIComponent(RETAILCRM_API_KEY)}` +
    `&filter[orders][]=${encodeURIComponent(order.id)}` +
    `&limit=200`;

  const historyResp = await fetch(historyUrl);
  const historyData = await historyResp.json();

  if (historyData.success && Array.isArray(historyData.history)) {
    const historyRows = historyData.history.map((h) => {
      const field = h.field || null;

      let changeType = 'field_change';
      if (field === 'status') changeType = 'status_change';
      else if (field === 'manager') changeType = 'manager_change';
      else if (field === 'comment') changeType = 'comment_change';

      const changerUserId =
        h.user && (h.user.id || h.user.externalId || h.user.id_external);

      return {
        order_id: orderRow.id,
        retailcrm_order_id: order.id,
        changed_at: h.createdAt || h.createdAtIso || h.createdAtUtc,
        changer_retailcrm_user_id: changerUserId || null,
        change_type: changeType,
        field_name: field,
        old_value: h.oldValue != null ? String(h.oldValue) : null,
        new_value: h.newValue != null ? String(h.newValue) : null,
        comment: h.comment || null,
        raw_payload: h,
      };
    });

    if (historyRows.length > 0) {
      const { error: histError } = await supabase
        .from('okk_order_history')
        .insert(historyRows);

      if (histError) {
        console.error('okk_order_history insert error:', histError);
      }
    }
  } else {
    console.warn('No history for order', order.id, historyData);
  }

  return { okk_order_id: orderRow.id, retailcrm_order_id: order.id };
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Use GET method' });
    return;
  }

  if (!RETAILCRM_API_KEY || !RETAILCRM_BASE_URL || !SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    res.status(500).json({ error: 'Missing required environment variables' });
    return;
  }

  // ?days=7  → за сколько дней назад тянуть
  const daysParam = parseInt(req.query.days, 10);
  const days = Number.isFinite(daysParam) && daysParam > 0 ? daysParam : 1;

  const fromDate = new Date();
  fromDate.setDate(fromDate.getDate() - days);
  const createdFrom = formatDateTimeForRetailCRM(fromDate);

  let page = 1;
  let totalPages = 1;

  let totalOrders = 0;
  let synced = 0;
  let failed = 0;

  const errors = [];

  try {
    while (page <= totalPages && page <= MAX_PAGES) {
      const ordersUrl =
        `${RETAILCRM_BASE_URL}/api/v5/orders` +
        `?apiKey=${encodeURIComponent(RETAILCRM_API_KEY)}` +
        `&filter[createdAtFrom]=${encodeURIComponent(createdFrom)}` +
        `&page=${page}` +
        `&limit=${PAGE_LIMIT}`;

      const resp = await fetch(ordersUrl);
      const data = await resp.json();

      if (!data.success) {
        errors.push({ page, error: data });
        break;
      }

      const orders = data.orders || [];
      const pagination = data.pagination || {};
      totalPages = pagination.totalPageCount || 1;

      totalOrders += orders.length;

      for (const order of orders) {
        try {
          await syncSingleOrderFromObject(order);
          synced += 1;
        } catch (err) {
          failed += 1;
          errors.push({ orderId: order.id, message: String(err) });
        }
      }

      page += 1;
    }

    res.status(200).json({
      success: true,
      message: 'Bulk sync completed',
      days,
      totalOrders,
      synced,
      failed,
      pagesProcessed: Math.min(totalPages, MAX_PAGES),
      errors,
    });
  } catch (err) {
    console.error('Unexpected error in retailcrm-sync-all:', err);
    res.status(500).json({ error: 'Unexpected error in sync-all', details: String(err) });
  }
}
