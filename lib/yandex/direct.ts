/**
 * Яндекс Директ: реклама, за которую платят деньги.
 *
 * Вебмастер показывает, как нас находят бесплатно; Директ — сколько мы платим
 * за то, чтобы нашли. Вместе они закрывают вход воронки: заявка, которой не
 * было, в CRM не появится, а открутка, которая была, стоила настоящих рублей.
 *
 * Здесь два разных права, и они намеренно разведены.
 *
 * Чтение — свободно: кампании, объявления, фразы, статистика. Смотреть можно
 * сколько угодно, это ничего не стоит и ничего не меняет.
 *
 * Запись — только создание черновика объявления, и только рукой владельца.
 * Модель не запускает кампании, не меняет ставки и не отправляет объявления на
 * модерацию: любое из этих действий тратит бюджет, а цена неверно понятой фразы
 * здесь измеряется в рублях, а не в потерянном времени.
 *
 * Песочница. Директ даёт отдельный контур с теми же методами и ненастоящими
 * деньгами. Пока YANDEX_DIRECT_SANDBOX=true, запросы идут туда — на этом
 * проверяется всё, кроме сумм.
 */

const LIVE = 'https://api.direct.yandex.com/json/v5';
const SANDBOX = 'https://api-sandbox.direct.yandex.com/json/v5';

export function directConfigured(): boolean {
    return Boolean(process.env.YANDEX_DIRECT_TOKEN);
}

/** Песочница ли сейчас. Это надо говорить вслух: цифры оттуда не настоящие. */
export function directSandbox(): boolean {
    return String(process.env.YANDEX_DIRECT_SANDBOX ?? '').toLowerCase() === 'true';
}

function base(): string {
    return directSandbox() ? SANDBOX : LIVE;
}

export type DirectError = { available: false; reason: string };

export function failed(v: unknown): v is DirectError {
    return Boolean(v) && (v as DirectError).available === false;
}

/**
 * Обращение к сервису Директа.
 *
 * Ошибку возвращаем текстом: инструмент должен объяснить, почему не вышло, а не
 * уронить разговор. Директ отвечает 200 даже на отказ, а причину кладёт в
 * error — поэтому проверяем не только код ответа.
 */
async function call<T>(service: string, method: string, params: Record<string, unknown>): Promise<T | DirectError> {
    const token = process.env.YANDEX_DIRECT_TOKEN;
    if (!token) {
        return { available: false, reason: 'нет доступа к Яндекс Директу: не задан YANDEX_DIRECT_TOKEN' };
    }

    try {
        const res = await fetch(`${base()}/${service}`, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${token}`,
                'Accept-Language': 'ru',
                'Content-Type': 'application/json; charset=utf-8',
                ...(process.env.YANDEX_DIRECT_CLIENT_LOGIN
                    ? { 'Client-Login': process.env.YANDEX_DIRECT_CLIENT_LOGIN }
                    : {}),
            },
            body: JSON.stringify({ method, params }),
            signal: AbortSignal.timeout(30_000),
        });

        const text = await res.text();
        if (res.status === 401 || res.status === 403) {
            return { available: false, reason: 'Директ не принял токен — он истёк или выдан без доступа direct:api' };
        }
        if (!res.ok) {
            return { available: false, reason: `Директ ответил ${res.status}: ${text.slice(0, 200)}` };
        }

        const json = JSON.parse(text);
        if (json?.error) {
            const e = json.error;
            return {
                available: false,
                reason: `Директ отказал: ${e.error_string ?? ''} ${e.error_detail ?? ''} (код ${e.error_code ?? '?'})`.trim(),
            };
        }
        return json.result as T;
    } catch (e: any) {
        return { available: false, reason: `Директ недоступен: ${String(e?.message ?? e).slice(0, 160)}` };
    }
}

// ── чтение ────────────────────────────────────────────────────────────────────

export async function campaigns() {
    return call<{ Campaigns: any[] }>('campaigns', 'get', {
        SelectionCriteria: {},
        FieldNames: ['Id', 'Name', 'State', 'Status', 'StatusPayment', 'Type', 'DailyBudget', 'Funds'],
    });
}

export async function adGroups(campaignIds?: number[]) {
    return call<{ AdGroups: any[] }>('adgroups', 'get', {
        SelectionCriteria: campaignIds?.length ? { CampaignIds: campaignIds } : {},
        FieldNames: ['Id', 'Name', 'CampaignId', 'Status', 'Type'],
        Page: { Limit: 200 },
    });
}

export async function ads(adGroupIds?: number[], campaignIds?: number[]) {
    return call<{ Ads: any[] }>('ads', 'get', {
        SelectionCriteria: {
            ...(adGroupIds?.length ? { AdGroupIds: adGroupIds } : {}),
            ...(campaignIds?.length ? { CampaignIds: campaignIds } : {}),
        },
        FieldNames: ['Id', 'CampaignId', 'AdGroupId', 'State', 'Status', 'Type'],
        TextAdFieldNames: ['Title', 'Title2', 'Text', 'Href'],
        Page: { Limit: 200 },
    });
}

export async function keywords(adGroupIds?: number[], campaignIds?: number[]) {
    return call<{ Keywords: any[] }>('keywords', 'get', {
        SelectionCriteria: {
            ...(adGroupIds?.length ? { AdGroupIds: adGroupIds } : {}),
            ...(campaignIds?.length ? { CampaignIds: campaignIds } : {}),
        },
        FieldNames: ['Id', 'AdGroupId', 'CampaignId', 'Keyword', 'State', 'Status'],
        Page: { Limit: 500 },
    });
}

/**
 * Статистика.
 *
 * Отчёты в Директе живут отдельно от остальных методов: у них свой адрес, своя
 * форма запроса и ответ таблицей, а не JSON. Тяжёлый отчёт ставится в очередь и
 * отдаётся не сразу — в этом случае честно говорим «ещё считается», а не
 * возвращаем пустоту, которую можно принять за ноль.
 */
export async function report(opts: {
    days?: number;
    by?: 'campaign' | 'search_query' | 'day';
}): Promise<{ header: string[]; rows: string[][] } | DirectError> {
    const token = process.env.YANDEX_DIRECT_TOKEN;
    if (!token) return { available: false, reason: 'нет доступа к Яндекс Директу: не задан YANDEX_DIRECT_TOKEN' };

    const days = Math.min(365, Math.max(1, opts.days ?? 30));
    const to = new Date();
    const from = new Date(to.getTime() - days * 86_400_000);
    const iso = (d: Date) => d.toISOString().slice(0, 10);

    const money = ['Impressions', 'Clicks', 'Ctr', 'Cost', 'AvgCpc', 'Conversions', 'CostPerConversion'];
    const dims =
        opts.by === 'search_query'
            ? ['CampaignName', 'Query']
            : opts.by === 'day'
              ? ['Date']
              : ['CampaignName'];

    const definition = {
        params: {
            SelectionCriteria: { DateFrom: iso(from), DateTo: iso(to) },
            FieldNames: [...dims, ...money],
            ReportName: `Тамара ${dims.join('-')} ${Date.now()}`,
            ReportType:
                opts.by === 'search_query' ? 'SEARCH_QUERY_PERFORMANCE_REPORT' : 'CAMPAIGN_PERFORMANCE_REPORT',
            DateRangeType: 'CUSTOM_DATE',
            Format: 'TSV',
            IncludeVAT: 'YES',
        },
    };

    try {
        const res = await fetch(`${base()}/reports`, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${token}`,
                'Accept-Language': 'ru',
                'Content-Type': 'application/json; charset=utf-8',
                processingMode: 'auto',
                returnMoneyInMicros: 'false',
                skipReportHeader: 'true',
                skipReportSummary: 'true',
                ...(process.env.YANDEX_DIRECT_CLIENT_LOGIN
                    ? { 'Client-Login': process.env.YANDEX_DIRECT_CLIENT_LOGIN }
                    : {}),
            },
            body: JSON.stringify(definition),
            signal: AbortSignal.timeout(60_000),
        });

        if (res.status === 201 || res.status === 202) {
            return {
                available: false,
                reason: 'Директ поставил отчёт в очередь и ещё считает его. Повтори тот же вопрос через минуту.',
            };
        }
        const text = await res.text();
        if (!res.ok) return { available: false, reason: `Директ ответил ${res.status}: ${text.slice(0, 200)}` };

        const lines = text.trim().split('\n').filter(Boolean);
        if (lines.length === 0) return { header: [], rows: [] };
        return { header: lines[0].split('\t'), rows: lines.slice(1).map((l) => l.split('\t')) };
    } catch (e: any) {
        return { available: false, reason: `Директ недоступен: ${String(e?.message ?? e).slice(0, 160)}` };
    }
}

// ── запись: единственное разрешённое действие ────────────────────────────────

export type DraftAd = {
    adGroupId: number;
    title: string;
    title2?: string;
    text: string;
    href: string;
};

/**
 * Создать объявление черновиком.
 *
 * На модерацию оно не отправляется и показов не получает, пока владелец сам не
 * отправит его в интерфейсе Директа. Это и есть предохранитель: даже ошибочно
 * подтверждённое предложение не откручивает ни рубля.
 */
export async function addDraftAd(draft: DraftAd) {
    return call<{ AddResults: any[] }>('ads', 'add', {
        Ads: [
            {
                AdGroupId: draft.adGroupId,
                TextAd: {
                    Title: draft.title,
                    ...(draft.title2 ? { Title2: draft.title2 } : {}),
                    Text: draft.text,
                    Href: draft.href,
                    Mobile: 'NO',
                },
            },
        ],
    });
}
