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
// Main handler — one chunk of initial sync
// ---------------------------------------------------------------------
export default async function handler(req, res) {
  try {
    // 1. Получаем/создаём состояние синка
    const { data: stateRows, error: stateError } = await supabase
      .from("okk_sync_state")
      .select("*")
      .eq("sync_type", "initial_orders")
      .limit(1);

    if (stateError) {
      console.error("Error loading sync state:", stateError);
      res.status(500).json({
        success: false,
        error: "Failed to load sync state from DB",
      });
      return;
    }

    let state = stateRows?.[0];

    if (!state) {
      const { data: newState, error: insertStateError } = await supabase
        .from("okk_sync_state")
        .insert({
          sync_type: "initial_orders",
          last_page: 1,
          is_completed: false,
        })
        .select()
        .single();

      if (insertStateError) {
        console.error("Error creating sync state:", insertStateError);
        res.status(500).json({
          success: false,
          error: "Failed to create sync state in DB",
        });
        return;
      }

      state = newState;
    }

    if (state.is_completed) {
      res.status(200).json({
        success: true,
        message: "Initial sync already completed",
      });
      return;
    }

    const CURRENT_PAGE = state.last_page || 1;

    // 2. Получаем рабочие статусы (по флагу is_controlled = true)
    const { data: statuses, error: statusesError } = await supabase
      .from("okk_sla_status")
      .select("status, status_code")
      .eq("is_controlled", true);

    if (statusesError) {
      console.error("Error loading controlled statuses:", statusesError);
      res.status(500).json({
        success: false,
        error: "Failed to load controlled statuses from DB",
      });
      return;
    }

    const statusCodeList =
      statuses
        ?.map((s) => s.status_code || s.status)
        .filter(Boolean) || [];

    if (!statusCodeList.length) {
      res.status(200).json({
        success: true,
        message:
          "No controlled statuses configured in okk_sla_status (status_code/status). Nothing to sync.",
        working_status_codes: [],
        total_orders: 0,
        total_pages: 0,
      });
      return;
    }

    // 3. Фильтр по ТЕКУЩЕМУ extendedStatus заказа (кодовые статусы)
    const LIMIT = 100;

    const statusQuery = statusCodeList
      .map(
        (code) => `filter[extendedStatus][]=${encodeURIComponent(code)}`
      )
      .join("&");

    const url =
      `${RETAILCRM_BASE_URL}/api/v5/orders` +
      `?apiKey=${encodeURIComponent(RETAILCRM_API_KEY)}` +
      (statusQuery ? `&${statusQuery}` : "") +
      `&limit=${LIMIT}` +
      `&page=${CURRENT_PAGE}`;

    // 4. Запрашиваем заказы из RetailCRM
    const response = await fetch(url);
    const json = await response.json();

    if (!json.success) {
      console.error("RetailCRM error (initial-sync-chunk):", json);
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

    // 5. Сохраняем заказы в okk_orders
    for (const order of orders) {
      try {
        const managerRetailId =
          order.manager?.id || order.manager?.externalId || null;

        const { data: managerData, error: managerError } = await supabase
          .from("okk_managers")
          .select("id")
          .eq("retailcrm_user_id", managerRetailId)
          .maybeSingle();

        if (managerError) {
          console.error(
            "Error loading manager for order",
            order.id,
            managerError
          );
        }

        const managerId = managerData?.id || null;

        await supabase.from("okk_orders").upsert(
          {
            retailcrm_order_id: order.id,
            number: order.number || String(order.id),

            created_at_crm: order.createdAt,
            status_updated_at_crm:
              order.statusUpdatedAt || order.updatedAt || order.createdAt,

            // Человеческое название статуса (как было)
            current_status: order.status,

            // КОДОВОЕ название текущего статуса (extendedStatus)
            current_status_code: order.extendedStatus || order.status || null,

            summ: typeof order.summ === "number" ? order.summ : null,
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

    // 6. Обновляем состояние синка
    let newStateFields;
    if (CURRENT_PAGE < totalPages) {
      newStateFields = {
        last_page: CURRENT_PAGE + 1,
      };
    } else {
      newStateFields = {
        last_page: CURRENT_PAGE,
        is_completed: true,
      };
    }

    const { error: updateStateError } = await supabase
      .from("okk_sync_state")
      .update(newStateFields)
      .eq("sync_type", "initial_orders");

    if (updateStateError) {
      console.error("Error updating sync state:", updateStateError);
    }

    res.status(200).json({
      success: true,
      message:
        "Chunk processed (only orders currently in working extended statuses by status_code).",
      working_status_codes: statusCodeList,
      page_processed: CURRENT_PAGE,
      total_pages: totalPages,
      orders_on_page: orders.length,
      total_orders: totalOrders,
      next_page: CURRENT_PAGE < totalPages ? CURRENT_PAGE + 1 : "COMPLETED",
    });
  } catch (error) {
    console.error("Fatal error in okk-initial-sync-chunk:", error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
}
