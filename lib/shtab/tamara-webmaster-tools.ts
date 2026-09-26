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
        return { sites: list, note: 'Права не подтверждены — данных по такому сайту Вебмастер не отдаст.' };
    }

    // Всем остальным нужен конкретный сайт. Разбор один на всех: где именно
    // ошиблись с адресом, инструмент скажет сам.
    const site = await resolveSite(args?.site ? String(args.site) : undefined);
    if (failed(site)) return site;

    const head = { site: site.url, note: NOTE };

    if (name === 'seo_summary') {
        const data = await summary(site.host_id);
        return failed(data) ? data : { ...head, summary: data };
    }

    if (name === 'seo_queries') {
        const data = await queries(site.host_id, { days: Number(args?.days) || undefined, limit: Number(args?.limit) || undefined });
        return failed(data) ? data : { ...head, days: Number(args?.days) || 28, queries: data };
    }

    if (name === 'seo_problems') {
        const data = await problems(site.host_id);
        return failed(data) ? data : { ...head, problems: data };
    }

    if (name === 'seo_pages') {
        const data = await inSearch(site.host_id, Number(args?.days) || 90);
        return failed(data) ? data : { ...head, days: Number(args?.days) || 90, in_search: data };
    }

    if (name === 'seo_crawl') {
        const data = await crawling(site.host_id, Number(args?.days) || 30);
        return failed(data) ? data : { ...head, days: Number(args?.days) || 30, crawling: data };
    }

    if (name === 'seo_links') {
        const data = await externalLinks(site.host_id, Number(args?.limit) || 30);
        return failed(data) ? data : { ...head, links: data };
    }

    return { available: false, reason: `неизвестный инструмент ${name}` };
}
