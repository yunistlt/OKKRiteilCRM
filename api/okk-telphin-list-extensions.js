// api/okk-telphin-list-extensions.js

const { TELPHIN_CLIENT_ID, TELPHIN_CLIENT_SECRET } = process.env;

const TELPHIN_API_BASE = 'https://apiproxy.telphin.ru';

// получение access_token по client_credentials
async function getTelphinToken() {
  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: TELPHIN_CLIENT_ID,
    client_secret: TELPHIN_CLIENT_SECRET,
  });

  const resp = await fetch(`${TELPHIN_API_BASE}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new Error(
      `Telphin OAuth error: ${resp.status} ${resp.statusText} ${text}`,
    );
  }

  return resp.json(); // { access_token, ... }
}

export default async function handler(req, res) {
  try {
    if (!TELPHIN_CLIENT_ID || !TELPHIN_CLIENT_SECRET) {
      return res
        .status(500)
        .json({ error: 'TELPHIN_CLIENT_ID / TELPHIN_CLIENT_SECRET not set' });
    }

    const { access_token } = await getTelphinToken();

    // список внутренних номеров текущего клиента
    const url = `${TELPHIN_API_BASE}/api/ver1.0/client/@me/extension/`;

    const resp = await fetch(url, {
      headers: { Authorization: `Bearer ${access_token}` },
    });

    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      throw new Error(
        `Telphin extension list error: ${resp.status} ${resp.statusText} ${text}`,
      );
    }

    const data = await resp.json();
    return res.status(200).json(data);
  } catch (err) {
    console.error('okk-telphin-list-extensions error:', err);
    return res.status(500).json({
      error: 'telphin_list_failed',
      message: err.message || String(err),
    });
  }
}
