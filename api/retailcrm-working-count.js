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
    // 1. Берём рабочие статусы
    const { data: statuses, error: stErr } = await supabase
      .from("okk_sla_status")
      .select("status")
      .eq("is_controlled", true);

    if (stErr) {
      res.status(500).json({ success: false, error: stErr.message });
      return;
    }

    const statusList = statuses.map(s => s.status).filter(Boolean);

    // 2. Формируем фильтр RetailCRM
    const statusQuery = statusList
      .map(s => `filter[status][]=${encodeURIComponent(s)}`)
      .join("&");

    // 3. Делаем тестовый запрос: limit=1 но отдаёт totalCount
    const url =
      `${RETAILCRM_BASE_URL}/api/v5/orders` +
      `?apiKey=${RETAILCRM_API_KEY}` +
      `&${statusQuery}` +
      `&limit=1` +
      `&page=1`;

    const r = await fetch(url);
    const json = await r.json();

    if (!json.success) {
      res.status(502).json({
        success: false,
        error: "RetailCRM error",
        details: json.errorMsg || json,
      });
      return;
    }

    res.status(200).json({
      success: true,
      working_statuses: statusList,
      total_orders_now: json.pagination?.totalCount ?? null,
      total_pages: json.pagination?.totalPageCount ?? null,
    });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
}
