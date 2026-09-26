/**
 * Яндекс Вебмастер: как сайт выглядит из поиска.
 *
 * Внутренние данные отвечают на вопрос «что у нас происходит», но молчат о том,
 * с чего всё начинается: видит ли нас поиск, по каким запросам приходят люди,
 * не закрылись ли страницы от индексации. Заявка, которой не было, в CRM не
 * появится — её не с чем сравнить, и провал на этой стороне не виден вовсе.
 *
 * Здесь только чтение. Вебмастер умеет и менять — переобход, удаление страниц,
 * подтверждение прав, — но эти действия меняют сайт в поиске, и доверять их
 * разговору нельзя.
 *
 * Сервис бесплатный, ключ — личный OAuth-токен владельца. Нет токена — все
 * инструменты честно говорят, чего не хватает, и ничего не выдумывают.
 */

const BASE = 'https://api.webmaster.yandex.net/v4';

export function webmasterConfigured(): boolean {
    return Boolean(process.env.YANDEX_WEBMASTER_TOKEN);
}

export type WmError = { available: false; reason: string };

/**
 * Запрос к Вебмастеру.
 *
 * Ошибку возвращаем текстом, а не бросаем: инструмент Тамары должен
 * рассказать, почему не вышло, а не уронить разговор. Отдельно разбираем 401 —
 * это почти всегда протухший токен, и знать это полезнее, чем код ответа.
 */
async function wmFetch<T>(path: string): Promise<T | WmError> {
    const token = process.env.YANDEX_WEBMASTER_TOKEN;
    if (!token) {
        return { available: false, reason: 'нет доступа к Яндекс Вебмастеру: не задан YANDEX_WEBMASTER_TOKEN' };
    }

    try {
        const res = await fetch(`${BASE}${path}`, {
            headers: { Authorization: `OAuth ${token}`, Accept: 'application/json' },
            signal: AbortSignal.timeout(20_000),
        });

        if (res.status === 401 || res.status === 403) {
            return {
                available: false,
                reason: 'Яндекс Вебмастер не принял токен — он истёк или выдан без доступа к webmaster',
            };
        }

        const text = await res.text();
        if (!res.ok) {
            return { available: false, reason: `Яндекс Вебмастер ответил ${res.status}: ${text.slice(0, 200)}` };
        }
        return JSON.parse(text) as T;
    } catch (e: any) {
        return { available: false, reason: `Яндекс Вебмастер недоступен: ${String(e?.message ?? e).slice(0, 160)}` };
    }
}

export function failed(v: unknown): v is WmError {
    return Boolean(v) && (v as WmError).available === false;
}

/**
 * Номер владельца в Вебмастере.
 *
 * Он стоит в каждом адресе API и не меняется, поэтому запрашивается один раз
 * на жизнь процесса: лишний поход по сети перед каждым вопросом ничего не
 * уточняет.
 */
let cachedUserId: number | null = null;

async function userId(): Promise<number | WmError> {
    if (cachedUserId !== null) return cachedUserId;
    const me = await wmFetch<{ user_id: number }>('/user/');
    if (failed(me)) return me;
    cachedUserId = me.user_id;
    return me.user_id;
}

export type Site = {
    /** Внутренний код сайта в Вебмастере, нужен для всех остальных запросов. */
    host_id: string;
    /** Адрес, как его пишет человек. */
    url: string;
    verified: boolean;
};

export async function sites(): Promise<Site[] | WmError> {
    const uid = await userId();
    if (failed(uid)) return uid;

    const list = await wmFetch<{ hosts: any[] }>(`/user/${uid}/hosts`);
    if (failed(list)) return list;

    return (list.hosts ?? []).map((h) => ({
        host_id: String(h.host_id),
        url: String(h.unicode_host_url ?? h.ascii_host_url ?? ''),
        verified: h.verified === true,
    }));
}

/**
 * Найти сайт по куску адреса.
 *
 * Сайтов у владельца несколько, и заставлять называть внутренний код Вебмастера
 * в разговоре — издевательство: «zmktlt» должно работать. Если не уточнили и
 * сайт один, берём его; если их несколько — просим выбрать, а не угадываем.
 */
export async function resolveSite(query?: string): Promise<Site | WmError> {
    const all = await sites();
    if (failed(all)) return all;
    if (all.length === 0) return { available: false, reason: 'в Вебмастере нет ни одного сайта' };

    if (!query) {
        if (all.length === 1) return all[0];
        return {
            available: false,
            reason: `сайтов несколько, уточни какой: ${all.map((s) => s.url).join(', ')}`,
        };
    }

    const needle = query.toLowerCase().replace(/^https?:\/\//, '').replace(/\/$/, '');
    const hit = all.find((s) => s.url.toLowerCase().includes(needle)) ?? all.find((s) => s.host_id === query);
    if (!hit) {
        return { available: false, reason: `сайт «${query}» не найден. Есть: ${all.map((s) => s.url).join(', ')}` };
    }
    return hit;
}

export async function summary(hostId: string) {
    const uid = await userId();
    if (failed(uid)) return uid;
    return wmFetch<Record<string, unknown>>(`/user/${uid}/hosts/${encodeURIComponent(hostId)}/summary`);
}

export async function problems(hostId: string) {
    const uid = await userId();
    if (failed(uid)) return uid;
    return wmFetch<Record<string, unknown>>(`/user/${uid}/hosts/${encodeURIComponent(hostId)}/diagnostics/`);
}

const DAY = 86_400_000;

function range(days: number, fallback: number): { from: string; to: string } {
    const span = Math.min(365, Math.max(7, days || fallback));
    const to = new Date();
    const from = new Date(to.getTime() - span * DAY);
    return { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) };
}

/**
 * Запросы, по которым сайт показывается в поиске.
 *
 * Берём и показы, и клики: показы без кликов — это «нас видят, но не выбирают»,
 * а это совсем другая беда, чем «нас не видят». Позиция идёт следом, потому что
 * без неё первые два числа не объяснить.
 */
export async function queries(hostId: string, opts: { days?: number; limit?: number } = {}) {
    const uid = await userId();
    if (failed(uid)) return uid;

    const { from, to } = range(opts.days ?? 0, 28);
    const params = new URLSearchParams({
        order_by: 'TOTAL_SHOWS',
        date_from: from,
        date_to: to,
        limit: String(Math.min(500, Math.max(1, opts.limit ?? 50))),
    });
    for (const ind of ['TOTAL_SHOWS', 'TOTAL_CLICKS', 'AVG_SHOW_POSITION', 'AVG_CLICK_POSITION']) {
        params.append('query_indicator', ind);
    }

    return wmFetch<Record<string, unknown>>(
        `/user/${uid}/hosts/${encodeURIComponent(hostId)}/search-queries/popular/?${params}`,
    );
}

/** Сколько страниц в поиске и как это менялось. */
export async function inSearch(hostId: string, days = 90) {
    const uid = await userId();
    if (failed(uid)) return uid;

    const { from, to } = range(days, 90);
    const params = new URLSearchParams({ date_from: from, date_to: to });
    return wmFetch<Record<string, unknown>>(
        `/user/${uid}/hosts/${encodeURIComponent(hostId)}/search-urls/in-search/history/?${params}`,
    );
}

/** Обход робота: сколько страниц обошёл и с какими ответами сервера. */
export async function crawling(hostId: string, days = 30) {
    const uid = await userId();
    if (failed(uid)) return uid;

    const { from, to } = range(days, 30);
    const params = new URLSearchParams({ date_from: from, date_to: to });
    return wmFetch<Record<string, unknown>>(
        `/user/${uid}/hosts/${encodeURIComponent(hostId)}/indexing/history/?${params}`,
    );
}

/** Внешние ссылки: сколько их и откуда. */
export async function externalLinks(hostId: string, limit = 30) {
    const uid = await userId();
    if (failed(uid)) return uid;

    const params = new URLSearchParams({ limit: String(Math.min(100, Math.max(1, limit))), offset: '0' });
    return wmFetch<Record<string, unknown>>(
        `/user/${uid}/hosts/${encodeURIComponent(hostId)}/links/external/samples/?${params}`,
    );
}
