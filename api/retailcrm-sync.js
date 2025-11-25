import { createClient } from '@supabase/supabase-js';

const {
  RETAILCRM_API_KEY,
  RETAILCRM_BASE_URL,
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
} = process.env;

if (!RETAILCRM_API_KEY || !RETAILCRM_BASE_URL || !SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.warn('Missing required environment variables for retailcrm-sync function');
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

/**
 * Vercel Serverless Function
 * GET /api/retailcrm-sync?number=50162
 */
export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Use GET method' });
    return;
  }

  const { number } = req.query;

  if (!number) {
    res.status(400).json({ error: 'Pass ?number=50162 (order number) for sync' });
    return;
  }

  try {
    // 1) Тянем заказ из RetailCRM по номеру
    const ordersUrl =
      `${RETAILCRM_BASE_URL}/api/v5/orders` +
      `?apiKey=${encodeURIComponent(RETAILCRM_API_KEY)}` +
      `&filter[number]=${encodeURIComponent(number)}` +
      `&limit=20`;

    const ordersResp = await fetch(ordersUrl);
    const ordersData = await ordersResp.json();

    if (!ordersData.success || !ordersData.orders || ordersData.orders.length === 0) {
      res.status(404).json({ error: 'Order not found in RetailCRM', raw: ordersData });
      return;
    }

    const order = ordersData.orders[0];

    // 2) Обновляем/создаём менеджера в okk_users
    let managerId = null;
    let managerRetailId =
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
        console.error('Supabase okk_users upsert error:', userError);
      } else if (userRow) {
        managerId = userRow.id;
      }
    }

    // 3) Готовим данные для okk_orders
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
      console.error('Supabase okk_orders upsert error:', orderError);
      res.status(500).json({ error: 'Supabase orders upsert error', details: orderError.message });
      return;
    }

    // 4) Тянем историю по этому заказу (через /orders/history)
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
          console.error('Supabase okk_order_history insert error:', histError);
        }
      }
    } else {
      console.warn('No history data or not success for order', order.id, historyData);
    }

    res.status(200).json({
      success: true,
      message: 'Order and history synced',
      retailcrm_order_id: order.id,
      okk_order_id: orderRow.id,
      number: order.number,
    });
  } catch (err) {
    console.error('Unexpected error in retailcrm-sync:', err);
    res.status(500).json({ error: 'Unexpected error', details: String(err) });
  }
}
