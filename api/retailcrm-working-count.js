// OKKRiteilCRM/api/retailcrm-working-count.js
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

export default async function handler(req, res) {
  try {
    // 1. Берём КОДЫ рабочих статусов из нашей таблицы
    const { data: rows, error: stErr } = await supabase
      .from("okk_sla_status")
      .select("status_code")
      .eq("is_controlled", true);

    if (stErr) {
      return res.status(500).json({
        success: false,
        error: "Failed to load statuses from okk_sla_status",
        details: stErr.message,
      });
    }

    const statusCodes =
      rows?.map((r) => r.status_code).filter(Boolean) ?? [];

    if (!statusCodes.length) {
      return res.status(200).json({
        success: true,
        message: "No controlled statuses with status_code found",
        working_status_codes: [],
        total_orders: 0,
        total_pages: 0,
      });
    }

    // 2. Собираем фильтр по extendedStatus = КОДАМ статусов
    const statusQuery = statusCodes
      .map(
        (code) =>
          `filter[extendedStatus][]=${encodeURIComponent(code)}`
      )
      .join("&");

    // RetailCRM требует limit из множества {20,50,100}
    const url =
      `${RETAILCRM_BASE_URL}/api/v5/orders` +
      `?apiKey=${encodeURIComponent(RETAILCRM_API_KEY)}` +
      `&${statusQuery}` +
      `&limit=20&page=1`;

    const r = await fetch(url);
    const json = await r.json();

    if (!json.success) {
      return res.status(502).json({
        success: false,
        error: "RetailCRM error",
        details: json.errorMsg || json,
      });
    }

    const totalCount = json.pagination?.totalCount ?? null;
    const totalPages = json.pagination?.totalPageCount ?? null;
    const ordersOnPage = (json.orders || []).length;

    return res.status(200).json({
      success: true,
      message:
        "Count of orders currently in working extended statuses (by status_code).",
      working_status_codes: statusCodes,
      total_orders: totalCount,
      total_pages: totalPages,
      sample_orders_on_page: ordersOnPage,
    });
  } catch (e) {
    return res.status(500).json({
      success: false,
      error: e.message,
    });
  }
}
