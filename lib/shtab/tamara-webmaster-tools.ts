import {
    crawling,
    externalLinks,
    failed,
    inSearch,
    problems,
    queries,
    resolveSite,
    sites,
    summary,
    webmasterConfigured,
} from '@/lib/yandex/webmaster';

/**
 * Поиск глазами Тамары.
 *
 * До сих пор она видела только то, что уже дошло до CRM: заявку, заказ, звонок.
 * Начало воронки было слепым пятном — по каким запросам нас находят, сколько
 * людей увидело и прошло мимо, не выпали ли страницы из поиска. Провал на этой
 * стороне не виден изнутри вовсе: незаглянувший клиент нигде не отмечается.
 *
 * Все инструменты только читают. Вебмастер умеет и менять — переобход, удаление
 * страниц, — но это правит сайт в поиске, и такому в разговоре не место.
 *
 * Сайт называется куском адреса, а не внутренним кодом: «zmktlt» работает.
 */

type ToolResult = Record<string, unknown>;

const SITE_ARG = {
    site: {
        type: 'string' as const,
        description: 'Кусок адреса сайта, например zmktlt. Если сайт в Вебмастере один — можно не указывать.',
    },
};

export const WEBMASTER_TOOLS = [
    {
        type: 'function' as const,
        function: {
            name: 'seo_sites',
            description:
                'Какие сайты подключены к Яндекс Вебмастеру и подтверждены ли права на них. Вызывай первым, если непонятно, о каком сайте речь.',
            parameters: { type: 'object', properties: {}, required: [] },
        },
    },
    {
        type: 'function' as const,
        function: {
            name: 'seo_summary',
            description:
                'Сводка по сайту в Яндексе: сколько страниц в поиске, ИКС, есть ли критичные проблемы. Отвечает на вопрос «как у нас дела в поиске» одним числом-другим.',
            parameters: { type: 'object', properties: { ...SITE_ARG }, required: [] },
        },
    },
    {
        type: 'function' as const,
        function: {
            name: 'seo_queries',
            description:
                'Запросы, по которым сайт показывается в Яндексе: показы, клики и средняя позиция. Этим объясняется начало воронки — почему заявок стало больше или меньше. Показы без кликов означают «нас видят, но не выбирают», и это другая беда, чем «нас не видят».',
            parameters: {
                type: 'object',
                properties: {
                    ...SITE_ARG,
                    days: { type: 'integer', description: 'За сколько дней, по умолчанию 28. От 7 до 365.' },
                    limit: { type: 'integer', description: 'Сколько запросов вернуть, по умолчанию 50.' },
                },
                required: [],
            },
        },
    },
    {
        type: 'function' as const,
        function: {
            name: 'seo_problems',
            description:
                'Что Яндекс считает неправильным на сайте: ошибки, предупреждения, рекомендации. Вызывай, когда страницы пропали из поиска или заявок стало меньше без понятной причины.',
            parameters: { type: 'object', properties: { ...SITE_ARG }, required: [] },
        },
    },
    {
        type: 'function' as const,
        function: {
            name: 'seo_pages',
            description:
                'Сколько страниц сайта в поиске Яндекса и как это менялось по дням. Падение здесь объясняет падение заявок раньше, чем это станет видно в CRM.',
            parameters: {
                type: 'object',
                properties: { ...SITE_ARG, days: { type: 'integer', description: 'За сколько дней, по умолчанию 90.' } },
                required: [],
            },
        },
    },
    {
        type: 'function' as const,
        function: {
            name: 'seo_crawl',
            description:
                'Обход сайта роботом Яндекса: сколько страниц обошёл и какими ответами отвечал сервер. Всплеск ошибок сервера здесь — причина, по которой страницы потом выпадают из поиска.',
            parameters: {
                type: 'object',
                properties: { ...SITE_ARG, days: { type: 'integer', description: 'За сколько дней, по умолчанию 30.' } },
                required: [],
            },
        },
    },
    {
        type: 'function' as const,
        function: {
            name: 'seo_links',
            description: 'Внешние ссылки на сайт: сколько их и с каких страниц. Кто на нас ссылается.',
            parameters: {
                type: 'object',
                properties: { ...SITE_ARG, limit: { type: 'integer', description: 'Сколько примеров, по умолчанию 30.' } },
                required: [],
            },
        },
    },
];

export const WEBMASTER_TOOL_NAMES: ReadonlySet<string> = new Set<string>(
    WEBMASTER_TOOLS.map((t) => t.function.name),
);

/** Пояснение к цифрам, чтобы их не путали с внутренними. */
const NOTE =
    'Данные Яндекс Вебмастера. Показ — сайт попал в выдачу; клик — по нему перешли. ' +
    'Это не заявки: часть пришедших ничего не оставит, и в CRM они не попадут.';

/**
 * Выдачу Вебмастера раскладываем в плоские строки.
 *
 * Ответ инструмента едет к модели заново на каждом витке разговора, и его
 * размер множится на число оставшихся витков. Вложенный JSON Яндекса тратит это
 * зря: у полусотни запросов имена полей повторяются полсотни раз. Строками с
 * одной шапкой то же самое занимает вдвое меньше.
 *
 * Если форма ответа окажется не та, что ожидалась, отдаём как есть: лучше
 * непривычный вид, чем пустая таблица и вывод, сделанный из ничего.
 */
function rowsOrRaw<T>(raw: any, pick: (raw: any) => T[] | null): T[] | any {
    try {
        const rows = pick(raw);
        return rows && rows.length ? rows : raw;
    } catch {
        return raw;
    }
}

const num = (v: unknown): number | null => (typeof v === 'number' ? v : null);

export async function executeWebmasterTool(name: string, args: any): Promise<ToolResult> {
    if (!webmasterConfigured()) {
        return {
            available: false,
            reason: 'Доступа к Яндекс Вебмастеру нет: не задан YANDEX_WEBMASTER_TOKEN. Скажи об этом владельцу — без токена данных поиска у меня нет.',
        };
    }

    if (name === 'seo_sites') {
        const list = await sites();
        if (failed(list)) return list;
        return {
            sites: list.map((h) => ({ адрес: h.url, права_подтверждены: h.verified })),
            note: 'По неподтверждённым сайтам Вебмастер данных не отдаёт.',
        };
    }

    // Всем остальным нужен конкретный сайт. Разбор один на всех: где именно
    // ошиблись с адресом, инструмент скажет сам.
    const site = await resolveSite(args?.site ? String(args.site) : undefined);
    if (failed(site)) return site;

    const head = { site: site.url, note: NOTE };

    if (name === 'seo_summary') {
        const data: any = await summary(site.host_id);
        if (failed(data)) return data;
        return {
            ...head,
            икс: num(data.sqi),
            страниц_в_поиске: num(data.searchable_pages_count),
            страниц_исключено: num(data.excluded_pages_count),
            проблемы_по_тяжести: data.site_problems ?? null,
        };
    }

    if (name === 'seo_queries') {
        const days = Number(args?.days) || 28;
        const data: any = await queries(site.host_id, { days, limit: Number(args?.limit) || undefined });
        if (failed(data)) return data;
        return {
            ...head,
            за_дней: days,
            запросы: rowsOrRaw(data, (d) =>
                (d.queries ?? []).map((q: any) => ({
                    запрос: q.query_text,
                    показы: num(q.indicators?.TOTAL_SHOWS),
                    клики: num(q.indicators?.TOTAL_CLICKS),
                    позиция_показа: num(q.indicators?.AVG_SHOW_POSITION),
                    позиция_клика: num(q.indicators?.AVG_CLICK_POSITION),
                })),
            ),
        };
    }

    if (name === 'seo_problems') {
        const data: any = await problems(site.host_id);
        if (failed(data)) return data;
        return {
            ...head,
            проблемы: rowsOrRaw(data, (d) =>
                (d.problems ?? [])
                    .filter((x: any) => x.state !== 'ABSENT')
                    .map((x: any) => ({
                        тяжесть: x.severity,
                        что: x.problem_type,
                        состояние: x.state,
                        обновлено: x.last_state_update,
                    })),
            ),
        };
    }

    if (name === 'seo_pages') {
        const days = Number(args?.days) || 90;
        const data: any = await inSearch(site.host_id, days);
        if (failed(data)) return data;
        return {
            ...head,
            за_дней: days,
            страниц_в_поиске_по_дням: rowsOrRaw(data, (d) =>
                (d.history ?? []).map((h: any) => ({ дата: String(h.date).slice(0, 10), страниц: num(h.value) })),
            ),
        };
    }

    if (name === 'seo_crawl') {
        const days = Number(args?.days) || 30;
        const data: any = await crawling(site.host_id, days);
        if (failed(data)) return data;
        // Яндекс отдаёт обход разрезанным по показателям: обойдено, ответы 2xx,
        // 4xx, 5xx — каждый своим рядом дат. Сводим в одну таблицу по датам:
        // всплеск ошибок и провал обхода видны только рядом друг с другом.
        return {
            ...head,
            за_дней: days,
            обход_по_дням: rowsOrRaw(data, (d) => {
                const groups = d.indicators ?? {};
                const byDate = new Map<string, Record<string, unknown>>();
                for (const [indicator, points] of Object.entries<any>(groups)) {
                    for (const pt of points ?? []) {
                        const day = String(pt.date).slice(0, 10);
                        const row = byDate.get(day) ?? { дата: day };
                        row[indicator] = num(pt.value);
                        byDate.set(day, row);
                    }
                }
                return Array.from(byDate.values()).sort((a: any, b: any) => (a.дата < b.дата ? -1 : 1));
            }),
        };
    }

    if (name === 'seo_links') {
        const data: any = await externalLinks(site.host_id, Number(args?.limit) || 30);
        if (failed(data)) return data;
        return {
            ...head,
            всего_ссылок: num(data.count),
            примеры: rowsOrRaw(data, (d) =>
                (d.links ?? []).map((l: any) => ({
                    откуда: l.source_url,
                    куда: l.destination_url,
                    замечена: String(l.discovery_date ?? '').slice(0, 10),
                })),
            ),
        };
    }

    return { available: false, reason: `неизвестный инструмент ${name}` };
}
