import { supabase } from '@/utils/supabase';
import {
    adGroups,
    ads,
    campaigns,
    directConfigured,
    directSandbox,
    failed,
    keywords,
    report,
} from '@/lib/yandex/direct';

/**
 * Реклама глазами Тамары.
 *
 * Чтение — свободно. Запись — одно-единственное действие: положить предложение
 * создать объявление, которое включает владелец нажатием. Модель не запускает
 * кампании, не трогает ставки и не отправляет объявления на модерацию: каждое
 * из этих действий тратит бюджет.
 *
 * Про песочницу инструменты говорят вслух в каждом ответе. Цифры оттуда
 * ненастоящие, и молча выдавать их за боевые — худшее, что тут можно сделать.
 */

type ToolResult = Record<string, unknown>;

export const DIRECT_TOOLS = [
    {
        type: 'function' as const,
        function: {
            name: 'ads_campaigns',
            description:
                'Рекламные кампании в Яндекс Директе: названия, включены ли, оплачены ли, дневной бюджет и остаток средств. Вызывай первым, когда речь про рекламу: дальше почти всё делается по номеру кампании.',
            parameters: { type: 'object', properties: {}, required: [] },
        },
    },
    {
        type: 'function' as const,
        function: {
            name: 'ads_stats',
            description:
                'Статистика рекламы: показы, клики, CTR, расход, средняя цена клика, конверсии и цена конверсии. Разрезы: по кампаниям, по дням или по поисковым запросам людей. Этим объясняется, куда ушли деньги и что они принесли.',
            parameters: {
                type: 'object',
                properties: {
                    by: {
                        type: 'string',
                        enum: ['campaign', 'day', 'search_query'],
                        description: 'Разрез: по кампаниям (по умолчанию), по дням или по запросам людей.',
                    },
                    days: { type: 'integer', description: 'За сколько дней, по умолчанию 30.' },
                },
                required: [],
            },
        },
    },
    {
        type: 'function' as const,
        function: {
            name: 'ads_items',
            description:
                'Объявления и ключевые фразы: что именно показывается людям и по каким словам. Нужно, чтобы написать новое объявление в том же духе или найти, где текст расходится с запросом.',
            parameters: {
                type: 'object',
                properties: {
                    campaign_id: { type: 'integer', description: 'Номер кампании из ads_campaigns.' },
                    ad_group_id: { type: 'integer', description: 'Номер группы объявлений, если нужна одна.' },
                },
                required: [],
            },
        },
    },
    {
        type: 'function' as const,
        function: {
            name: 'ads_groups',
            description: 'Группы объявлений в кампании. Номер группы нужен, чтобы предложить в неё новое объявление.',
            parameters: {
                type: 'object',
                properties: { campaign_id: { type: 'integer', description: 'Номер кампании из ads_campaigns.' } },
                required: [],
            },
        },
    },
    {
        type: 'function' as const,
        function: {
            name: 'ads_propose',
            description:
                'Предложить владельцу создать объявление. Само объявление НЕ создаётся: предложение появляется карточкой в разговоре, владелец нажимает «создать». Даже после нажатия объявление кладётся черновиком и показов не получает, пока владелец сам не отправит его на модерацию. Перед предложением посмотри ads_items — новое объявление должно отличаться от тех, что уже работают, иначе оно бессмысленно.',
            parameters: {
                type: 'object',
                properties: {
                    ad_group_id: { type: 'integer', description: 'В какую группу. Номер берётся из ads_groups.' },
                    title: { type: 'string', description: 'Заголовок, до 56 знаков.' },
                    title2: { type: 'string', description: 'Второй заголовок, до 30 знаков. Необязателен.' },
                    text: { type: 'string', description: 'Текст объявления, до 81 знака.' },
                    href: { type: 'string', description: 'Ссылка на страницу сайта.' },
                    keywords: { type: 'string', description: 'Фразы, под которые написано, через запятую.' },
                    reason: { type: 'string', description: 'Зачем это объявление. Одна фраза по делу.' },
                    evidence: { type: 'string', description: 'На каких числах основано: запросы, показы, расход.' },
                },
                required: ['ad_group_id', 'title', 'text', 'href', 'reason'],
            },
        },
    },
];

export const DIRECT_TOOL_NAMES: ReadonlySet<string> = new Set<string>(DIRECT_TOOLS.map((t) => t.function.name));

/** Ограничения Директа на длину. Нарушишь — откажет уже после подтверждения. */
const LIMITS = { title: 56, title2: 30, text: 81 };

function tooLong(draft: { title: string; title2?: string; text: string }): string | null {
    if (draft.title.length > LIMITS.title) return `заголовок ${draft.title.length} знаков, можно ${LIMITS.title}`;
    if (draft.title2 && draft.title2.length > LIMITS.title2) {
        return `второй заголовок ${draft.title2.length} знаков, можно ${LIMITS.title2}`;
    }
    if (draft.text.length > LIMITS.text) return `текст ${draft.text.length} знаков, можно ${LIMITS.text}`;
    return null;
}

/** Приписка про песочницу. Ставится в каждый ответ, пока она включена. */
function head(): Record<string, unknown> {
    return directSandbox()
        ? { песочница: true, note: 'ВКЛЮЧЕНА ПЕСОЧНИЦА ДИРЕКТА. Эти цифры ненастоящие, называть их владельцу как боевые нельзя.' }
        : {};
}

export async function executeDirectTool(
    name: string,
    args: any,
    ctx: { conversationId?: number | null } = {},
): Promise<ToolResult> {
    if (!directConfigured()) {
        return {
            available: false,
            reason: 'Доступа к Яндекс Директу нет: не задан YANDEX_DIRECT_TOKEN. Скажи об этом владельцу — без токена данных по рекламе у меня нет.',
        };
    }

    if (name === 'ads_campaigns') {
        const data = await campaigns();
        if (failed(data)) return data;
        return {
            ...head(),
            кампании: (data.Campaigns ?? []).map((c: any) => ({
                номер: c.Id,
                название: c.Name,
                включена: c.State,
                состояние: c.Status,
                оплата: c.StatusPayment,
                тип: c.Type,
                дневной_бюджет: c.DailyBudget?.Amount ?? null,
                остаток: c.Funds?.CampaignFunds?.Balance ?? c.Funds?.SharedAccountFunds?.Refund ?? null,
            })),
        };
    }

    if (name === 'ads_groups') {
        const cid = Number(args?.campaign_id);
        const data = await adGroups(Number.isFinite(cid) ? [cid] : undefined);
        if (failed(data)) return data;
        return {
            ...head(),
            группы: (data.AdGroups ?? []).map((g: any) => ({
                номер: g.Id,
                название: g.Name,
                кампания: g.CampaignId,
                состояние: g.Status,
            })),
        };
    }

    if (name === 'ads_stats') {
        const by = (args?.by as 'campaign' | 'day' | 'search_query') ?? 'campaign';
        const days = Number(args?.days) || 30;
        const data = await report({ by, days });
        if (failed(data)) return data;
        return {
            ...head(),
            разрез: by,
            за_дней: days,
            столбцы: data.header,
            строки: data.rows,
            note: 'Клик — переход на сайт, не заявка. Часть пришедших ничего не оставит, и в CRM они не попадут.',
        };
    }

    if (name === 'ads_items') {
        const cid = Number(args?.campaign_id);
        const gid = Number(args?.ad_group_id);
        const groups = Number.isFinite(gid) ? [gid] : undefined;
        const camps = Number.isFinite(cid) ? [cid] : undefined;

        const [a, k] = await Promise.all([ads(groups, camps), keywords(groups, camps)]);
        if (failed(a)) return a;
        if (failed(k)) return k;

        return {
            ...head(),
            объявления: (a.Ads ?? []).map((x: any) => ({
                номер: x.Id,
                группа: x.AdGroupId,
                состояние: x.Status,
                показ: x.State,
                заголовок: x.TextAd?.Title ?? null,
                заголовок2: x.TextAd?.Title2 ?? null,
                текст: x.TextAd?.Text ?? null,
                ссылка: x.TextAd?.Href ?? null,
            })),
            фразы: (k.Keywords ?? []).map((x: any) => ({
                номер: x.Id,
                группа: x.AdGroupId,
                фраза: x.Keyword,
                состояние: x.Status,
                показ: x.State,
            })),
        };
    }

    if (name === 'ads_propose') {
        const draft = {
            adGroupId: Number(args?.ad_group_id),
            title: String(args?.title ?? '').trim(),
            title2: args?.title2 ? String(args.title2).trim() : undefined,
            text: String(args?.text ?? '').trim(),
            href: String(args?.href ?? '').trim(),
        };

        if (!Number.isFinite(draft.adGroupId) || draft.adGroupId <= 0) {
            return { available: false, reason: 'не указана группа объявлений: возьми её номер через ads_groups' };
        }
        if (!draft.title || !draft.text || !draft.href) {
            return { available: false, reason: 'нужны заголовок, текст и ссылка' };
        }
        // Длину проверяем здесь, а не после подтверждения: отказ Директа
        // владелец увидел бы уже после нажатия, и виноватым выглядел бы он.
        const long = tooLong(draft);
        if (long) return { available: false, reason: `Директ не примет: ${long}` };

        const { data, error } = await supabase
            .from('ad_draft_proposal')
            .insert({
                ad_group_id: draft.adGroupId,
                title: draft.title,
                title2: draft.title2 ?? null,
                body: draft.text,
                href: draft.href,
                keywords: args?.keywords ? String(args.keywords) : null,
                reason: String(args?.reason ?? '').trim(),
                evidence: args?.evidence ? String(args.evidence) : null,
                sandbox: directSandbox(),
                conversation_id: ctx.conversationId ?? null,
            })
            .select('id')
            .single();

        if (error) return { available: false, reason: `предложение не сохранилось: ${error.message}` };

        return {
            ...head(),
            предложение: (data as any).id,
            статус: 'ждёт решения владельца',
            note: 'Объявление НЕ создано. Владелец увидит карточку в разговоре и нажмёт «создать». Даже после этого оно ляжет черновиком и показов не получит, пока он сам не отправит его на модерацию.',
        };
    }

    return { available: false, reason: `неизвестный инструмент ${name}` };
}
