// ОТВЕТСТВЕННЫЙ: СЕМЁН (Архивариус) — Техническая интеграция с API Телфин и генерация токенов.
const TELPHIN_FETCH_TIMEOUT_MS = 15000;

export async function fetchTelphin(url: string, init?: RequestInit) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TELPHIN_FETCH_TIMEOUT_MS);

    try {
        return await fetch(url, {
            ...init,
            signal: controller.signal,
        });
    } catch (error: any) {
        if (error?.name === 'AbortError') {
            throw new Error(`Telphin request timeout after ${TELPHIN_FETCH_TIMEOUT_MS}ms`);
        }
        throw new Error(`Telphin network error: ${error?.message || 'Unknown fetch error'}`);
    } finally {
        clearTimeout(timeout);
    }
}

export async function getTelphinToken() {
    const TELPHIN_KEY = process.env.TELPHIN_APP_KEY || process.env.TELPHIN_CLIENT_ID;
    const TELPHIN_SECRET = process.env.TELPHIN_APP_SECRET || process.env.TELPHIN_CLIENT_SECRET;

    if (!TELPHIN_KEY || !TELPHIN_SECRET) {
        throw new Error('Telphin config missing (KEY/SECRET)');
    }

    const params = new URLSearchParams();
    params.append('grant_type', 'client_credentials');
    params.append('client_id', TELPHIN_KEY);
    params.append('client_secret', TELPHIN_SECRET);
    params.append('scope', 'all');

    const res = await fetchTelphin('https://apiproxy.telphin.ru/oauth/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: params
    });

    if (!res.ok) {
        const text = await res.text();
        throw new Error(`Telphin Auth Failed: ${res.status} ${text}`);
    }

    const data = await res.json();
    return data.access_token;
}

export async function initiateMakeCall(params: {
    extensionId: string;
    source: string;
    destination: string;
}) {
    const token = await getTelphinToken();
    const TELPHIN_KEY = process.env.TELPHIN_APP_KEY || process.env.TELPHIN_CLIENT_ID;

    // API URL: https://apiproxy.telphin.ru/api/ver1.0/client/{client_id}/extension/{extension_id}/makecall
    // Source: Number to call first (managers group)
    // Destination: Number to call second (client)
    const res = await fetchTelphin(`https://apiproxy.telphin.ru/api/ver1.0/client/${TELPHIN_KEY}/extension/${params.extensionId}/makecall`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
            source: params.source,
            destination: params.destination
        })
    });

    if (!res.ok) {
        const text = await res.text();
        throw new Error(`Telphin MakeCall Failed: ${res.status} ${text}`);
    }

    const data = await res.json();
    return {
        callId: data.call_id,
        success: true
    };
}
