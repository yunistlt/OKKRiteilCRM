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

// Универсальная функция синка одного заказа
async function syncSingleOrder(order) {
  let managerId = null;

  const managerRetailId =
    order.managerId ||
    (order.manager && (order.manager.id || order.manager.externalId));

  if (managerRetailId) {
    const managerFullName =
      (order.manager &&
        `${order.manager.firstName || ''} ${order.manager.lastName || ''}`.trim()) ||
      `User ${managerRetailId}`;

    const { data: userRow } = await supabase
      .from('okk_users')
      .upsert(
        {
          retailcrm_user_id: managerRetailId,
          full_name: managerFullName,
          role: 'manager',
        },
        { onConflict: 'retailcrm_user_id' }
      )
      .select('id')
      .single();

    managerId = userRow?.id || null;
  }

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
    order.delivery &&
    (order.delivery.code ||
      (order.delivery.service && order.delivery.service.code));

  const payloadOrder = {
    retailcrm_order_id: order.id,
    number: order.number || String(order.id),
    created_at_crm: order.createdAt,
    status_updated_at_crm: order.statusUpdatedAt || order.updatedAt || order.createdAt,
    current_status: order.status,
    summ,
    purchase_summ: purchaseSumm,
    manager_retailcrm_id: managerRetailId,
    manager_id: managerId,
    paid,
    payment_type: paymentType,
    shipped: !!order.shipped,
    delivery_type: deliveryType,
    custom_fields: order.customFields || {},
    items: order.items || [],
  };

  const { data: okkOrder } = await supabase
    .from('okk_orders')
    .upsert(payloadOrder, { onConflict: 'retailcrm_order_id' })
    .select('id')
    .single();

  const historyUrl =
    `${RETAILCRM_BASE_URL}/api/v5/orders/history` +
    `?apiKey=${encodeURIComponent(RETAILCRM_API_KEY)}` +
    `&filter[orders][]=${encodeURIComponent(order.id)}` +
    `&limit=200`;

  const historyResp = await fetch(historyUrl);
  const historyData = await historyResp.json();

  if (historyData.success) {
    const rows = historyData.history.map((h) => ({
      order_id: okkOrder.id,
      retailcrm_order_id: order.id,
      changed_at: h.createdAt || h.createdAtIso || h.createdAtUtc,
      changer_retailcrm_user_id:
        h.user && (h.user.id || h.user.externalId || h.user.id_external),
      change_type:
        h.field === 'status'
          ? 'status_change'
          : h.field === 'manager'
          ? 'manager_change'
          : h.field === 'comment'
          ? 'comment_change'
          : 'field_change',
      field_name: h.field,
      old_value: h.oldValue != null ? String(h.oldValue) : null,
      new_value: h.newValue != null ? String(h.newValue) : null,
      comment: h.comment || null,
      raw_payload: h,
    }));

    if (rows.length > 0) {
      await supabase.from('okk_order_history').insert(rows);
    }
  }

  return okkOrder.id;
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Use GET' });
    return;
  }

  // 1) Получаем статусы, отмеченные как is_controlled
  const { data: statuses, error: statusesError } = await supabase
    .from('okk_sla_status')
    .select('status')
    .eq('is_controlled', true);

  if (statusesError) {
    console.error('Supabase error (okk_sla_status):', statusesError);
    res.status(500).json({ error: 'Supabase error', details: statusesError.message });
    return;
  }

  const statusList = statuses?.map((s) => s.status) || [];

  if (statusList.length === 0) {
    res.status(200).json({ success: true, message: 'No controlled statuses' });
    return;
  }

  // 2) Тянем заказы по этим статусам с пагинацией
  const statusQuery = statusList
    .map((s) => `statuses[]=${encodeURIComponent(s)}`)
    .join('&');

  const LIMIT = 100;
  let page = 1;
  let totalPages = 1;
  let synced = 0;
  let totalOrders = 0;

  try {
    do {
      const url =
        `${RETAILCRM_BASE_URL}/api/v5/orders` +
        `?apiKey=${encodeURIComponent(RETAILCRM_API_KEY)}` +
        `&${statusQuery}` +
        `&limit=${LIMIT}` +
        `&page=${page}`;

      const resp = await fetch(url);
      const data = await resp.json();

      if (!data.success) {
        console.error('RetailCRM error:', data);
        res.status(500).json({ error: 'RetailCRM error', raw: data });
        return;
      }

      const pagination = data.pagination || {};
      totalPages = pagination.totalPageCount || 1;
      totalOrders = pagination.totalCount || (data.orders?.length || 0);

      for (const order of data.orders || []) {
        await syncSingleOrder(order);
        synced++;
      }

      page += 1;
    } while (page <= totalPages);
  } catch (err) {
    console.error('okk-daily-sync fatal error:', err);
    res.status(500).json({ error: 'Internal error', details: String(err) });
    return;
  }

  res.status(200).json({
    success: true,
    statuses: statusList,
    totalOrders,
    synced,
    pagesProcessed: totalPages,
  });
}
