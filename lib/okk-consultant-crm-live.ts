import { getCrmConfig } from '@/lib/retailcrm/leads';
import { supabase } from '@/utils/supabase';

// Живая RetailCRM как второй источник Семёна.
//
// У него уже есть наша база: там вся подноготная — история статусов до
// удалений, расшифровки звонков, переписка, оценки качества. Чего там нет —
// сегодняшнего утра: копия наполняется кроном, и между выгрузками она отстаёт.
// В выходные это заметно особенно: в субботу последнее событие в истории было
// вечером пятницы, и это правильно, а не поломка.
//
// Отсюда разделение, которое Семён обязан соблюдать:
//
//   «что сейчас» — статус заказа, кто ответственный, оплачен ли счёт — CRM;
//   «что было и почему» — история, звонки, письма, динамика — наша база.
//
// Спрашивать историю у CRM бессмысленно (её API отдаёт состояние, а не путь), а
// спрашивать текущий статус у копии — значит однажды сказать владельцу, что
// заказ в производстве, когда его утром отменили.

export type LiveOrder = {
    number: string;
    id: number;
    status: string;
    statusName: string;
    manager: string | null;
    totalSumm: number;
    /** Сумма прописью разрядов: модель повторяет в ответе то, что получила. */
    totalSummText: string;
    createdAt: string;
    customer: string | null;
    nextContactDate: string | null;
    site: string;
};

async function crmFetch(path: string): Promise<any> {
    const { url, key } = await getCrmConfig();
    const res = await fetch(`${url}/api/v5/${path}`, { headers: { 'X-API-KEY': key } });
    const data = await res.json();
    if (!data.success && data.errorMsg) throw new Error(data.errorMsg);
    return data;
}

/**
 * Русское имя статуса по коду.
 *
 * CRM в ответе отдаёт код (prepayed), а человеку нужно «Счет на оплате».
 * Справочник статусов лежит в нашей базе и синхронизируется из той же CRM —
 * это тот случай, когда два источника не спорят, а дополняют друг друга.
 */
async function statusNames(codes: string[]): Promise<Map<string, string>> {
    if (codes.length === 0) return new Map();
    const { data } = await supabase.from('statuses').select('code, name').in('code', codes);
    return new Map(((data ?? []) as any[]).map((r) => [r.code, r.name]));
}

/**
 * Код статуса по тому, как его назвал человек.
 *
 * Менеджер говорит «счета на оплате», а не «prepayed», и требовать от него код —
 * значит переложить на человека работу программы. Сначала точное совпадение по
 * имени, потом вхождение, и только потом принимаем строку как код.
 */
export async function resolveStatusCode(input: string): Promise<string | null> {
    const raw = input.trim();
    if (!raw) return null;

    const { data } = await supabase.from('statuses').select('code, name').eq('is_active', true);
    const rows = ((data ?? []) as any[]).map((r) => ({ code: String(r.code), name: String(r.name ?? '') }));

    const lower = raw.toLowerCase();
    const exactCode = rows.find((r) => r.code.toLowerCase() === lower);
    if (exactCode) return exactCode.code;

    const exactName = rows.find((r) => r.name.toLowerCase() === lower);
    if (exactName) return exactName.code;

    const partial = rows.find((r) => r.name.toLowerCase().includes(lower) || lower.includes(r.name.toLowerCase()));
    return partial ? partial.code : null;
}

/** Заказ, как он выглядит в CRM прямо сейчас. */
export async function liveOrder(orderNumber: string): Promise<LiveOrder | null> {
    const data = await crmFetch(`orders?filter[numbers][]=${encodeURIComponent(orderNumber)}&limit=20`);
    const o = (data.orders ?? [])[0];
    if (!o) return null;

    const names = await statusNames([o.status]);

    return {
        number: String(o.number),
        id: Number(o.id),
        status: o.status,
        statusName: names.get(o.status) || o.status,
        manager: o.managerId ? String(o.managerId) : null,
        totalSumm: Number(o.totalSumm ?? 0),
        totalSummText: `${Math.round(Number(o.totalSumm ?? 0)).toLocaleString('ru-RU')} ₽`,
        createdAt: o.createdAt,
        customer: o.customer?.nickName ?? null,
        nextContactDate: o.customFields?.data_kontakta ?? null,
        site: o.site,
    };
}

/**
 * Сколько заказов сейчас в статусе и на какую сумму.
 *
 * limit в API v5 принимает только 20, 50 и 100 — другие значения дают 400.
 * Здесь нужен не список, а счётчик, поэтому берём минимальную страницу и
 * читаем итог из пагинации.
 */
export async function liveStatusCount(statusCode: string): Promise<{ status: string; count: number; sample: string[] }> {
    const data = await crmFetch(`orders?filter[extendedStatus][]=${encodeURIComponent(statusCode)}&limit=20`);
    const names = await statusNames([statusCode]);
    return {
        status: names.get(statusCode) || statusCode,
        count: Number(data.pagination?.totalCount ?? 0),
        sample: (data.orders ?? []).slice(0, 5).map((o: any) => `№${o.number} — ${o.customer?.nickName ?? 'клиент не указан'}`),
    };
}

export const CRM_LIVE_TOOLS = [
    {
        type: 'function' as const,
        function: {
            name: 'crm_order_now',
            description:
                'Состояние заказа в RetailCRM ПРЯМО СЕЙЧАС: статус, сумма, ответственный, дата следующего контакта. Вызывай, когда вопрос о текущем положении дел по конкретному заказу. Наша база наполняется кроном и к утру может отставать — для «что сейчас» источник только этот.',
            parameters: {
                type: 'object',
                properties: {
                    order_number: { type: 'string', description: 'Номер заказа, например 54132' },
                },
                required: ['order_number'],
            },
        },
    },
    {
        type: 'function' as const,
        function: {
            name: 'crm_status_now',
            description:
                'Сколько заказов сейчас в указанном статусе в RetailCRM. Для «сколько сегодня на оплате», «сколько в производстве». Статус называй по-русски, как его зовут люди («Счет на оплате», «Передано в производство») — код искать не нужно. Историю и динамику здесь не спрашивай: CRM отдаёт состояние, а не путь, за историей иди в нашу базу.',
            parameters: {
                type: 'object',
                properties: {
                    status_code: { type: 'string', description: 'Название статуса по-русски или его код' },
                },
                required: ['status_code'],
            },
        },
    },
] as const;

export const CRM_LIVE_TOOL_NAMES: ReadonlySet<string> = new Set<string>(
    CRM_LIVE_TOOLS.map((t) => t.function.name),
);

export async function executeCrmLiveTool(name: string, args: any): Promise<any> {
    try {
        if (name === 'crm_order_now') {
            const order = await liveOrder(String(args?.order_number ?? '').trim());
            return order
                ? { source: 'RetailCRM, актуально на сейчас', order }
                : { available: false, reason: 'Такого заказа в CRM нет' };
        }
        if (name === 'crm_status_now') {
            const code = await resolveStatusCode(String(args?.status_code ?? ''));
            if (!code) return { available: false, reason: 'Не понял, какой статус — назови так, как он пишется в CRM' };
            const res = await liveStatusCount(code);
            return { source: 'RetailCRM, актуально на сейчас', ...res };
        }
        return { available: false, reason: `Неизвестный инструмент: ${name}` };
    } catch (e: any) {
        // CRM недоступна — это не повод рушить ответ: у Семёна остаётся наша
        // база, надо лишь честно сказать, что свежести в ответе нет.
        return { available: false, reason: `RetailCRM не ответила: ${e.message}` };
    }
}
