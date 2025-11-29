// api/okk-daily-sync.js
import { createClient } from "@supabase/supabase-js";

const {
  RETAILCRM_API_KEY,
  RETAILCRM_BASE_URL,
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
} = process.env;

const MAX_PAGES_PER_RUN = 10;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

// Синк 1 заказа
async function syncSingleOrder(order) {
  const managerRetailId =
    order.manager?.id || order.manager?.externalId || null;

  let managerId = null;
  if (managerRetailId) {
    const { data: managerData } = await supabase
      .from("okk_users")
      .select("id")
      .eq("retailcrm_user_id", managerRetailId)
      .maybeSingle();

    managerId = managerData?.id || null;
  }

  const paid =
    typeof order.paid === "boolean"
      ? order.paid
      : order.paymentStatus === "paid" ||
        order.paymentStatus === "complete";

  const payloadOrder = {
    retailcrm_order_id: order.id,
    number: order.number || String(order.id),
    created_at_crm: order.createdAt,
    status_updated_at_crm:
      order.statusUpdatedAt || order.updatedAt || order.createdAt,
    current_status: order.status,
    current_status_code: order.status,
    summ: typeof order.summ === "number" ? order.summ : null,
    purchase_summ:
      typeof order.purchaseSumm === "number" ? order.purchaseSumm : null,
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

  const { error } = await supabase
    .from("okk_orders")
    .upsert(payloadOrder, { onConflict: "retailcrm_order_id" });

  if (error) throw error;
}

// MAIN handler
export default async function handler(req, res) {
  try {
    if (req.method !== "GET") {
      return res.status(405).json({ success: false, error: "Method not allowed" });
    }

    // 1) читаем состояние синка
    const { data: stateRow } = await supabase
      .from("okk_sync_state")
      .select("*")
      .eq("sync_type", "orders")
      .maybeSingle();

    let page = stateRow?.last_page || 1;
    let isCompleted = stateRow?.is_completed || false;

    if (isCompleted) {
      return res.status(200).json({
        success: true,
        message: "Initial sync already completed",
      });
    }

    let totalPages = 1;
    let totalOrders = 0;
    let synced = 0;

    // 2) Перебор страниц
    let pagesProcessed = 0;

    while (pagesProcessed < MAX_PAGES_PER_RUN) {
      const url =
        `${RETAILCRM_BASE_URL}/api/v5/orders` +
        `?apiKey=${encodeURIComponent(RETAILCRM_API_KEY)}` +
        `&limit=100&page=${page}`;

      const r = await fetch(url);
      const json = await r.json();

      if (!json.success) {
        throw new Error(json.error || "RetailCRM error");
      }

      totalPages = json.pagination?.totalPageCount || 1;
      totalOrders = json.pagination?.totalCount || 0;

      for (const order of json.orders || []) {
        await syncSingleOrder(order);
        synced++;
      }

      // завершили страницу
      pagesProcessed++;
      page++;

      // если дошли до конца
      if (page > totalPages) {
        isCompleted = true;
        break;
      }
    }

    // 3) сохраняем состояние синка
    await supabase
      .from("okk_sync_state")
      .upsert({
        sync_type: "orders",
        last_page: page,
        is_completed: isCompleted,
      }, {
        onConflict: "sync_type",
      });

    res.status(200).json({
      success: true,
      synced,
      totalOrders,
      totalPages,
      nextPage: page,
      isCompleted,
    });
  } catch (e) {
    console.error("okk-daily-sync error", e);
    res.status(500).json({ success: false, error: e.message });
  }
}
