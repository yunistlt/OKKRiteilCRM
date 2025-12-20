// api/telphin-count.js
const TELPHIN_API_BASE = 'https://apiproxy.telphin.ru';
const TELPHIN_API_VERSION = '/api/ver1.0';

function formatTelphinDate(d) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

async function getTelphinToken() {
  const {
    TELPHIN_CLIENT_ID,
    TELPHIN_CLIENT_SECRET,
  } = process.env;

  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: TELPHIN_CLIENT_ID,
    client_secret: TELPHIN_CLIENT_SECRET,
    scope: 'all',
  });

  const r = await fetch(`${TELPHIN_API_BASE}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });

  const j = await r.json();
  if (!r.ok) throw new Error(JSON.stringify(j));
  return j.access_token;
}

async function fetchPage(token, extensionId, from, to, page) {
  const q = new URLSearchParams({
    start_datetime: formatTelphinDate(from),
    end_datetime: formatTelphinDate(to),
    order: 'asc',
    page: String(page),
  });

  const r = await fetch(
    `${TELPHIN_API_BASE}${TELPHIN_API_VERSION}/extension/${extensionId}/record/?${q.toString()}`,
    { headers: { Authorization: `Bearer ${token}` } }
  );

  const j = await r.json();
  if (!r.ok) throw new Error(JSON.stringify(j));
  return Array.isArray(j) ? j : [];
}

export default async function handler(req, res) {
  try {
    const from = req.query.from ? new Date(req.query.from) : new Date(Date.now() - 24*60*60*1000);
    const to = req.query.to ? new Date(req.query.to) : new Date();
    const extensionId = Number(req.query.ext || 349963); // по умолчанию твой ext

    const token = await getTelphinToken();

    let page = 1;
    let total = 0;

    while (true) {
      const rows = await fetchPage(token, extensionId, from, to, page);
      if (!rows.length) break;
      total += rows.length;
      page++;
      if (page > 2000) break; // защита
    }

    return res.status(200).json({ status: 'ok', ext: extensionId, from: from.toISOString(), to: to.toISOString(), total });
  } catch (e) {
    return res.status(500).json({ error: String(e) });
  }
}
