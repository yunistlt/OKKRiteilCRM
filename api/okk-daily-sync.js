// api/okk-daily-sync.js
import { createClient } from '@supabase/supabase-js';

const {
  RETAILCRM_API_KEY,
  RETAILCRM_BASE_URL,
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
} = process.env;

if (!RETAILCRM_API_KEY || !RETAILCRM_BASE_URL || !SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('[okk-daily-sync] Missing required env vars');
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

// ---- вспомогалки ----

function formatDateForRetail(date) {
  // YYYY-MM-DD HH:MM:SS
  return date.toISOString().slice(0, 19).replace('T', ' ');
}

// Синк одного заказа + истории (аккуратно перенесено из retailcrm-sync)
async function syncSingleOrder(order) {
  const summ = typeof order.summ === 'number' ? order.summ : null;
  const purchaseSumm = typeof order.purchaseSumm === 'number' ? order.purchaseSumm : null;

  const managerRetailId =
    order.manager && (order.manager.id || order.manager.externalId || null);

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
      : order.paymentStatus === 'paid' || order.paymentStatus === 'complete';

  const paymentType = order.payments?.[0]?.type || null;

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

  const { data: okkOrder, error: upsertError } = await supabase
    .from('okk_orders')
    .upsert(payloadOrder, { onConflict: 'retailcrm_order_id' })
    .select('id')
    .single();

  if (upsertError) {
    console.error('[okk-daily-sync] Supabase upsert okk_orders error:', upsertError);
    throw upsertError;
  }

  const okkOrderId = okkOrder.id;

  // История по одному заказу
  const historyUrl =
    `${RETAILCRM_BASE_URL}/api/v5/orders/history` +
    `?apiKey=${encodeURIComponent(RETAILCRM_API_KEY)}` +
    `&filter[orderNumber]=${encodeURIComponent(order.number || String(order.id))}` +
    `&limit=100`;

  const historyResp = await fetch(historyUrl);
  const historyJson = await historyResp.json();

  if (!historyJson.success) {
    console.error('[okk-daily-sync] RetailCRM history error:', historyJson);
    throw new Error('RetailCRM history error');
  }

  const histories = historyJson.history || [];

  if (histories.length > 0) {
    const historyPayload = histories.map((h) => ({
      okk_order_id: okkOrderId,
      retailcrm_order_id: order.id,
      created_at_crm: h.createdAt,
      new_status: h.newValue?.status || null,
      old_status: h.oldValue?.status || null,
      raw: h,
    }));

    const { error: historyError } = await supabase
      .from('okk_order_history')
      .upsert(historyPayload, { onConflict: 'okk_order_id,created_at_crm' });

    if (historyError) {
      console.error('[okk-daily-sync] Supabase okk_order_history error:', historyError);
      throw historyError;
    }
  }
}

// ---- основной handler ----

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Use GET' });
    return;
  }

  const startTime = Date.now();

  // days – за сколько дней назад тянем обновления статусов (по умолчанию 1 день)
  const days = req.query.days ? Number(req.query.days) : 1;
  const MAX_PAGES = req.query.maxPages ? Number(req.query.maxPages) : 3;

  // 1) Берём контролируемые статусы
  const { data: statuses, error: statusesError } = await supabase
    .from('okk_sla_status')
    .select('status')
    .eq('is_controlled', true);

  if (statusesError) {
    console.error('[okk-daily-sync] Supabase okk_sla_status error:', statusesError);
    res.status(500).json({ error: 'Supabase error', details: statusesError.message });
    return;
  }

  const statusList = statuses?.map((s) => s.status).filter(Boolean) || [];

  if (statusList.length === 0) {
    res.status(200).json({ success: true, message: 'No controlled statuses' });
    return;
  }

  // 2) Формируем фильтр: только за последние N дней по statusUpdatedAtFrom
  const fromDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const fromStr = formatDateForRetail(fromDate);

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
      // защита по времени – если прошло больше 240 секунд, выходим
      if (Date.now() - startTime > 240_000) {
        console.warn('[okk-daily-sync] Time limit reached, finishing early');
        break;
      }

      const url =
        `${RETAILCRM_BASE_URL}/api/v5/orders` +
        `?apiKey=${encodeURIComponent(RETAILCRM_API_KEY)}` +
        `&${statusQuery}` +
        `&filter[statusUpdatedAtFrom]=${encodeURIComponent(fromStr)}` +
        `&limit=${LIMIT}` +
        `&page=${page}`;

      console.log('[okk-daily-sync] Fetch page', page, 'url:', url);

      const resp = await fetch(url);
      const json = await resp.json();

      if (!json.success) {
        console.error('[okk-daily-sync] RetailCRM orders error:', json);
        res.status(502).json({ error: 'RetailCRM error', details: json.errorMsg || json });
        return;
      }

      const orders = json.orders || [];
      totalPages = json.pagination?.totalPageCount || 1;
      totalOrders = json.pagination?.totalCount || 0;

      console.log(
        `[okk-daily-sync] page ${page}/${totalPages}, orders on page: ${orders.length}`
      );

      for (const order of orders) {
        try {
          await syncSingleOrder(order);
          synced += 1;
        } catch (orderErr) {
          console.error('[okk-daily-sync] Error syncing order', order.id, orderErr);
          // здесь не роняем весь процесс, просто логируем
        }
      }

      page += 1;
    } while (page <= totalPages && page <= MAX_PAGES);

    res.status(200).json({
      success: true,
      message: 'Daily sync completed (possibly partial if time/page limit hit)',
      statuses: statusList,
      days,
      totalOrders,
      synced,
      pagesProcessed: Math.min(totalPages, MAX_PAGES, page - 1),
    });
  } catch (err) {
    console.error('okk-daily-sync fatal error:', err);
    res.status(500).json({ error: 'Internal error', details: String(err) });
  }
}
