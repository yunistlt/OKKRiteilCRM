// OKKRiteilCRM/api/retailcrm-working-count.js
import { createClient } from "@supabase/supabase-js";

const {
  RETAILCRM_API_KEY,
  RETAILCRM_BASE_URL,
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
} = process.env;

if (!RETAILCRM_API_KEY || !RETAILCRM_BASE_URL) {
  console.warn(
    "RetailCRM env missing: RETAILCRM_API_KEY or RETAILCRM_BASE_URL is not set"
  );
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

export default async function handler(req, res) {
  try {
    // 1. Берём из БД список рабочих статусов (is_controlled = true)
    const { data: statuses, error: statusesError } = await supabase
      .from("okk_sla_status")
      .select("status")
      .eq("is_controlled", true);

    if (statusesError) {
      console.error("Error loading controlled statuses:", statusesError);
      res.status(500).json({
        success: false,
        error: "Failed to load controlled statuses from DB",
      });
      return;
    }

    const statusList = statuses?.map((s) => s.status).filter(Boolean) || [];

    if (!statusList.length) {
      res.status(200).json({
        success: true,
        message: "No controlled statuses configured (okk_sla_status)",
        working_statuses: [],
        total_orders: 0,
        total_pages: 0,
      });
      return;
    }

    // 2. Собираем фильтр по ТЕКУЩЕМУ статусу заказа
    // filter[extendedStatus][]=СТАТУС
    const statusQuery = statusList
      .map((s) => `filter[extendedStatus][]=${encodeURIComponent(s)}`)
      .join("&");

    const url =
      `${RETAILCRM_BASE_URL}/api/v5/orders` +
      `?apiKey=${encodeURIComponent(RETAILCRM_API_KEY)}` +
      (statusQuery ? `&${statusQuery}` : "") +
      `&limit=1` +
      `&page=1`;

    // 3. Делаем тестовый запрос к RetailCRM
    const response = await fetch(url);
    const json = await response.json();

    if (!json.success) {
      console.error("RetailCRM error in working-count:", json);
      res.status(502).json({
        success: false,
        error: "RetailCRM error",
        details: json.errorMsg || json,
      });
      return;
    }

    const totalPages = json.pagination?.totalPageCount ?? null;
    const totalOrders = json.pagination?.totalCount ?? null;

    res.status(200).json({
      success: true,
      message:
        "Test query OK. This is only a count of orders currently in working statuses.",
      working_statuses: statusList,
      total_orders: totalOrders,
      total_pages: totalPages,
      sample_orders_on_page: (json.orders || []).length,
    });
  } catch (error) {
    console.error("Fatal error in retailcrm-working-count:", error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
}
