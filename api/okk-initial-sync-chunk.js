// OKKRiteilCRM/api/okk-initial-sync-chunk.js

import { createClient } from "@supabase/supabase-js";

const {
  RETAILCRM_API_KEY,
  RETAILCRM_BASE_URL,
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
} = process.env;

if (!RETAILCRM_API_KEY || !RETAILCRM_BASE_URL || !SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error("[okk-initial-sync] Missing required env vars");
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

export default async function handler(req, res) {
  try {
    // 1. Берём кодовые статусы, которые мы считаем "рабочими"
    const { data: statusRows, error: stErr } = await supabase
      .from("okk_sla_status")
      .select("status_code")
      .eq("is_controlled", true);

    if (stErr) {
      console.error("[okk-initial-sync] Failed to load okk_sla_status:", stErr);
      return res.status(500).json({
        success: false,
        error: "Failed to load working statuses from okk_sla_status",
        details: stErr.message,
      });
    }

    const statusCodes =
      (statusRows || [])
        .map((r) => r.status_code)
        .filter(Boolean);

    if (!statusCodes.length) {
      return res.status(200).json({
        success: true,
        message: "No controlled statuses configured in okk_sla_status",
        working_status_codes: [],
        totalOrdersFromCRM: 0,
        syncedToDb: 0,
        pagesProcessed: 0,
      });
    }

    // 2. Собираем фильтр по ТЕКУЩЕМУ кодовому статусу заказа
    //    filter[extendedStatus][]=status_code
    const statusQuery = statusCodes
      .map((code) => `filter[extendedStatus][]=${encodeURIComponent(code)}`)
      .join("&");

    const LIMIT = 100;
    const MAX_PAGES = 50; // для наших ~872 заказов хватит с огромным запасом

    let page = 1;
    let totalPages = null;
    let totalOrders = null;
    let synced = 0;

    while (true) {
      const url =
        `${RETAILCRM_BASE_URL}/api/v5/orders` +
        `?apiKey=${encodeURIComponent(RETAILCRM_API_KEY)}` +
        `&${statusQuery}` +
        `&limit=${LIMIT}` +
        `&page=${page}`;

      const resp = await fetch(url);
      const json = await resp.json();

      if (!json.success) {
        console.error("[okk-initial-sync] RetailCRM error:", json);
        return res.status(502).json({
          success: false,
          error: "RetailCRM error in okk-initial-sync-chunk",
          details: json.errorMsg || json,
        });
      }

      const orders = json.orders || [];

      if (totalPages == null) {
        totalPages = json.pagination?.totalPageCount ?? 1;
      }
      if (totalOrders == null) {
        totalOrders = json.pagination?.totalCount ?? orders.length;
      }

      // Если на странице пусто — дальше смысла нет
      if (!orders.length) {
        break;
      }

      // 3. Сохраняем заказы в okk_orders
      for (const order of orders) {
        try {
          const managerRetailId =
            order.manager?.id || order.manager?.externalId || null;

          let managerId = null;
          if (managerRetailId) {
            const { data: mRow, error: mErr } = await supabase
              .from("okk_managers")
              .select("id")
              .eq("retailcrm_user_id", managerRetailId)
              .maybeSingle();

            if (!mErr && mRow) {
              managerId = mRow.id;
            }
          }

          const payload = {
            retailcrm_order_id: order.id,
            number: order.number || String(order.id),
            created_at_crm: order.createdAt,
            status_updated_at_crm:
              order.statusUpdatedAt || order.updatedAt || order.createdAt,
            status_code: order.status,        // код статуса
            current_status_code: order.status,   // код для наших выборок
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
            synced_at: new Date().toISOString(),
          };

          const { error: upErr } = await supabase
            .from("okk_orders")
            .upsert(payload, { onConflict: "retailcrm_order_id" });

          if (upErr) {
            console.error(
              "[okk-initial-sync] upsert error for order",
              order.id,
              upErr
            );
          } else {
            synced += 1;
          }
        } catch (err) {
          console.error(
            "[okk-initial-sync] unexpected error on order",
            order?.id,
            err
          );
        }
      }

      // 4. Условия выхода из цикла
      if (page >= totalPages) break;
      if (page >= MAX_PAGES) break;

      page += 1;
    }

    // 5. Помечаем состояние как завершённое (для информации)
    await supabase.from("okk_sync_state").upsert(
      {
        sync_type: "initial_orders",
        last_page: totalPages ?? page,
        is_completed: true,
      },
      { onConflict: "sync_type" }
    );

    res.status(200).json({
      success: true,
      message: "Initial sync of current working-status orders completed",
      working_status_codes: statusCodes,
      totalOrdersFromCRM: totalOrders,
      syncedToDb: synced,
      pagesProcessed: page,
      totalPages,
    });
  } catch (error) {
    console.error("Fatal error in okk-initial-sync-chunk:", error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
}
