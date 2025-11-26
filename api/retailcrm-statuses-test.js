// OKKRiteilCRM/api/retailcrm-statuses-test.js
export default async function handler(req, res) {
  try {
    const { RETAILCRM_API_KEY, RETAILCRM_BASE_URL } = process.env;

    const url =
      `${RETAILCRM_BASE_URL}/api/v5/reference/statuses` +
      `?apiKey=${RETAILCRM_API_KEY}`;

    const r = await fetch(url);
    const json = await r.json();

    if (!json.success) {
      return res.status(502).json({
        success: false,
        error: "RetailCRM error",
        details: json.errorMsg || json,
      });
    }

    const statuses = json.statuses || {};
    const list = Object.entries(statuses).map(([code, info]) => ({
      code,
      name: info.name,
      group: info.group,
      active: info.active,
    }));

    return res.status(200).json({
      success: true,
      total: list.length,
      statuses: list,
    });
  } catch (e) {
    return res.status(500).json({ success: false, error: e.message });
  }
}
