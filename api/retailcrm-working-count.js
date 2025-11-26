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
    const { data: statuses } = await supabase
      .from("okk_sla_status")
      .select("status")
      .eq("is_controlled", true);

    const statusList = statuses.map(s => s.status);

    // 2. Правильный фильтр — только filter[status][]
   const statusQuery = statusList
  .map((s) => `filter[extendedStatus][]=${encodeURIComponent(s)}`)
  .join("&");

    // 3. Минимальный тест: limit=1 но pagination отдаёт totalCount
    const url =
      `${RETAILCRM_BASE_URL}/api/v5/orders` +
      `?apiKey=${RETAILCRM_API_KEY}` +
      `&${statusQuery}` +
      `&limit=20&page=1`;

    const r = await fetch(url);
    const json = await r.json();

    res.status(200).json(json);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
