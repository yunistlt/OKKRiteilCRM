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

const TELPHIN_API = 'https://apiproxy.telphin.ru/api/ver1.0';

// Числовой client_id аккаунта (НЕ ключ приложения) — Телфин требует его в пути REST-эндпоинтов.
// Кэшируем на процесс: он не меняется.
let cachedClientId: string | null = null;
export async function getTelphinClientId(token: string): Promise<string> {
    if (cachedClientId) return cachedClientId;
    const res = await fetchTelphin(`${TELPHIN_API}/client/`, {
        headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw new Error(`Telphin get client failed: ${res.status} ${await res.text()}`);
    const data = await res.json();
    const client = Array.isArray(data) ? data[0] : data;
    const id = client?.client_id ?? client?.id;
    if (!id) throw new Error(`Telphin client_id not found in /client/ response: ${JSON.stringify(data).slice(0, 300)}`);
    cachedClientId = String(id);
    return cachedClientId;
}

// Внутренний extension_id по короткому номеру добавочного (напр. 105 → 44xxxxx).
const extensionIdCache = new Map<string, string>();
export async function getTelphinExtensionId(token: string, clientId: string, extNumber: string): Promise<string> {
    const cacheKey = `${clientId}:${extNumber}`;
    const cached = extensionIdCache.get(cacheKey);
    if (cached) return cached;
    const res = await fetchTelphin(`${TELPHIN_API}/client/${clientId}/extension/`, {
        headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw new Error(`Telphin get extensions failed: ${res.status} ${await res.text()}`);
    const data = await res.json();
    const list: any[] = Array.isArray(data) ? data : (data?.extensions ?? []);
    const match = list.find((e: any) => String(e.number ?? e.name ?? e.extension_number) === String(extNumber));
    const id = match?.extension_id ?? match?.id;
    if (!id) throw new Error(`Telphin extension ${extNumber} not found among ${list.length} extensions`);
    const resolved = String(id);
    extensionIdCache.set(cacheKey, resolved);
    return resolved;
}

export async function initiateMakeCall(params: {
    extensionId: string;   // короткий номер добавочного-инициатора (напр. 105)
    source: string;        // первое плечо — очередь ОП (напр. 200)
    destination: string;   // второе плечо — телефон клиента
}) {
    const token = await getTelphinToken();
    const clientId = await getTelphinClientId(token);
    const extensionId = await getTelphinExtensionId(token, clientId, params.extensionId);

    // POST /api/ver1.0/extension/{extension_id}/callback/
    // src_num (массив) — первое плечо (очередь ОП), dst_num — второе плечо (клиент).
    const res = await fetchTelphin(`${TELPHIN_API}/extension/${extensionId}/callback/`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
            src_num: [params.source],
            dst_num: params.destination
        })
    });

    if (!res.ok) {
        const text = await res.text();
        throw new Error(`Telphin Callback Failed: ${res.status} ${text} [ext=${extensionId} src=${params.source} dst=${params.destination}]`);
    }

    const data = await res.json();
    return {
        callId: data.call_id,
        success: true
    };
}
