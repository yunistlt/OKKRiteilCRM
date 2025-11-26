// OKKRiteilCRM/api/okk-initial-sync-chunk.js
import { createClient } from "@supabase/supabase-js";

const {
  RETAILCRM_API_KEY,
  RETAILCRM_BASE_URL,
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
} = process.env;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

// ---------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------
function formatDate(date) {
  return date.toISOString().slice(0, 19).replace("T", " ");
}

// ---------------------------------------------------------------------
// Main handler — один чанк первичной загрузки
// ---------------------------------------------------------------------
export default async function handler(req, res) {
  try {
    // 1. Получаем/создаём состояние синка
    const { data: stateRows } = await supabase
      .from("okk_sync_state")
      .select("*")
      .eq("sync_type", "initial_orders")
      .limit(1);

    let state = stateRows?.[0];

    if (!state) {
      const { data: newState } = await supabase
        .from("okk_sync_state")
        .insert({
          sync_type: "initial_orders",
          last_page: 1,
          is_completed: false,
        })
        .select()
        .single();

      state = newState;
    }

    if (state.is_completed) {
      res.status(200).json({
        success: true,
        message: "Initial sync already completed",
      });
      return;
    }

    const CURRENT_PAGE = state.last_page;

    // 2. Берём список КОНТРОЛИРУЕМЫХ статусов (рабочие статусы)
    const { data: statuses, error: statusesError } = await supabase
      .from("okk_sla_status")
      .select("status")
      .eq("is_controlled", true);

    if (statusesError) {
      console.error("Error loading statuses:", statusesError);
      res.status(500).json({
        success: false,
        error: "Failed to load controlled statuses from DB",
      });
      return;
    }

    const statusList = statuses?.map((s) => s.status) || [];

    // 3. Собираем запрос в RetailCRM:
    //    filter[extendedStatus][] = <код статуса>
    //    → это именно заказы, которые СЕЙЧАС в этих статусах
    const LIMIT = 100;

    const statusQuery = statusList
      .map((s) => `filter[extendedStatus][]=${encodeURIComponent(s)}`)
      .join("&");

    const url =
      `${RETAILCRM_BASE_URL}/api/v5/orders` +
      `?apiKey=${encodeURIComponent(RETAILCRM_API_KEY)}` +
      (statusQuery ? `&${statusQuery}` : "") +
      `&limit=${LIMIT}` +
      `&page=${CURRENT_PAGE}`;

    const response = await fetch(url);
    const json = await response.json();

    if (!json.success) {
      console.error("RetailCRM error:", json);
      res.status(502).json({
        success: false,
        error: "RetailCRM error",
        details: json.errorMsg || json,
      });
      return;
    }

    const orders = json.orders || [];
    const totalPages = json.pagination?.totalPageCount || 1;
    const totalOrders = json.pagination?.totalCount || 0;

    // 4. Сохраняем заказы (без истории, чтобы быстрее)
    for (const order of orders) {
      try {
        const managerRetailId =
          order.manager?.id || order.manager?.externalId || null;

        const { data: managerData } = await supabase
          .from("okk_managers")
          .select("id")
          .eq("retailcrm_user_id", managerRetailId)
          .maybeSingle();

        const managerId = managerData?.id || null;

        await supabase.from("okk_orders").upsert(
          {
            retailcrm_order_id: order.id,
            number: order.number || String(order.id),
            created_at_crm: order.createdAt,
            status_updated_at_crm:
              order.statusUpdatedAt || order.updatedAt || order.createdAt,
            current_status: order.status,
            summ:
              typeof order.summ === "number"
                ? order.summ
                : typeof order.totalSumm === "number"
                ? order.totalSumm
                : null,
            purchase_summ:
              typeof order.purchaseSumm === "number"
                ? order.purchaseSumm
                : null,
            manager_retailcrm_id: managerRetailId,
            manager_id: managerId,
            paid:
              typeof order.paid === "boolean"
                ? order.paid
                : order.paymentStatus === "paid" ||
                  order.paymentStatus === "complete",
            payment_type: order.payments?.[0]?.type || null,
            shipped: !!order.shipped,
            delivery_type:
              order.delivery?.code || order.delivery?.service?.code || null,
            custom_fields: order.customFields || {},
            items: order.items || [],
          },
          { onConflict: "retailcrm_order_id" }
        );
      } catch (err) {
        console.error("Error writing order:", order.id, err);
      }
    }

    // 5. Обновляем состояние синка
    let newState;
    if (CURRENT_PAGE < totalPages) {
      newState = { last_page: CURRENT_PAGE + 1 };
    } else {
      newState = { last_page: CURRENT_PAGE, is_completed: true };
    }

    await supabase
      .from("okk_sync_state")
      .update(newState)
      .eq("sync_type", "initial_orders");

    res.status(200).json({
      success: true,
      message: "Chunk processed",
      page_processed: CURRENT_PAGE,
      total_pages: totalPages,
      orders_on_page: orders.length,
      total_orders: totalOrders,
      next_page:
        CURRENT_PAGE < totalPages ? CURRENT_PAGE + 1 : "COMPLETED",
    });
  } catch (error) {
    console.error("Fatal error:", error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
}
