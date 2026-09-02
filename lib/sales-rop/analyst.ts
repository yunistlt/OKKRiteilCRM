import { createHash } from 'node:crypto';
import { supabase } from '@/utils/supabase';
import { getOpenAIClient, isOpenAIConfigured } from '@/utils/openai';
import { AiAgent, recordAiUsage } from '@/lib/ai-usage';

// Второй слой бота-РОПа: модель читает досье клиента и говорит, о чём с ним
// разговаривать.
//
// Граница слоёв проведена так: код решает, КОГО трогать сегодня, модель — О ЧЁМ
// говорить. Числа, списки заказов и учёт касаний модель не видит и испортить не
// может; всё, что она делает, — читает то, что код уже собрал, и формулирует
// повод для звонка.
//
// Результат кэшируется по отпечатку досье: пока факты о клиенте не изменились,
// платить за повторный разбор незачем.

export type Dossier = {
    clientName: string;
    sphereName: string;
    sphereCode: string | null;
    ordersCount: number;
    totalAmount: number;
    firstOrder: string | null;
    lastOrder: string | null;
    byYear: Record<string, number>;
    byCategory: Record<string, number>;
    recentOrders: Array<{ number: string; date: string; amount: number }>;
    managerComments: string[];
    callTranscripts: string[];
};

export type Insight = {
    opportunity: string;
    talkTrack: string;
    evidence: string;
    caution: string;
};

export function dossierFingerprint(d: Dossier): string {
    // В отпечаток идёт то, от чего меняется вывод: покупки, комментарии, звонки.
    // Имя клиента и сфера меняются редко и вывод не двигают.
    const payload = JSON.stringify([
        d.ordersCount,
        d.totalAmount,
        d.lastOrder,
        d.byCategory,
        d.managerComments.length,
        d.callTranscripts.map((t) => t.length),
    ]);
    return createHash('sha256').update(payload).digest('hex').slice(0, 16);
}

export async function loadDossier(clientKey: string): Promise<Dossier | null> {
    const { data, error } = await supabase.rpc('sales_client_dossier', { p_client_key: clientKey });
    if (error) throw new Error(error.message);
    const r = ((data ?? []) as any[])[0];
    if (!r) return null;

    return {
        clientName: r.client_name ?? '',
        sphereName: r.sphere_name ?? '',
        sphereCode: r.sphere_code ?? null,
        ordersCount: Number(r.orders_count ?? 0),
        totalAmount: Number(r.total_amount ?? 0),
        firstOrder: r.first_order ?? null,
        lastOrder: r.last_order ?? null,
        byYear: r.by_year ?? {},
        byCategory: r.by_category ?? {},
        recentOrders: r.recent_orders ?? [],
        managerComments: (r.manager_comments ?? []).filter(Boolean),
        callTranscripts: (r.call_transcripts ?? []).filter(Boolean),
    };
}

/** Текст досье для модели. Русский и человеческий: его читает и модель, и человек при разборе. */
export function renderDossier(d: Dossier, catalog: string[], rules: SolutionRule[] = []): string {
    const money = (v: number) => Math.round(v).toLocaleString('ru-RU');
    const lines = [
        `Клиент: ${d.clientName}`,
        `Сфера деятельности: ${d.sphereName}`,
        `Покупок: ${d.ordersCount} на ${money(d.totalAmount)} ₽`,
        `Первая покупка: ${(d.firstOrder ?? '').slice(0, 10) || 'неизвестно'}, последняя: ${(d.lastOrder ?? '').slice(0, 10) || 'неизвестно'}`,
        `По годам: ${Object.entries(d.byYear).map(([y, s]) => `${y} — ${money(Number(s))} ₽`).join('; ') || 'нет данных'}`,
        `Что берёт: ${Object.entries(d.byCategory).map(([c, n]) => `${c} (${n})`).join('; ') || 'не разобрано'}`,
    ];

    if (d.recentOrders.length > 0) {
        lines.push(
            'Последние заказы: ' +
                d.recentOrders.map((o) => `№${o.number} от ${o.date} на ${money(Number(o.amount))} ₽`).join('; '),
        );
    }
    if (d.managerComments.length > 0) {
        lines.push('', 'Комментарии менеджеров:', ...d.managerComments.map((c) => `— ${c}`));
    }
    if (d.callTranscripts.length > 0) {
        lines.push('', 'Расшифровки последних звонков:', ...d.callTranscripts.map((t, i) => `[звонок ${i + 1}]\n${t}`));
    }

    lines.push('', `Что мы производим (только из этого списка можно предлагать): ${catalog.join(', ')}`);

    if (rules.length > 0) {
        lines.push(
            '',
            'Что обычно нужно клиенту с таким набором (проверено владельцем, опирайся на это):',
            ...rules.map((r) => `— ${r.segment}: взял «${r.trigger}» → нужен «${r.offer}». Почему: ${r.why} (${r.availability})`),
        );
    }
    return lines.join('\n');
}

export type SolutionRule = { segment: string; trigger: string; offer: string; why: string; availability: string };

/**
 * Правила из карты решений, подходящие клиенту.
 *
 * Отбор по тому, что он уже берёт: правило «купил муфельную печь — нужна
 * вытяжка» применимо к тому, у кого печь есть. Статистику совместных покупок мы
 * из подсказок убрали: из неё выходил совет предложить фланцы покупателю
 * сушильных шкафов, потому что четырнадцать клиентов брали и то и другое.
 *
 * Берутся только подтверждённые строки: непроверенная догадка в устах бота
 * выглядит как знание о товаре, а менеджер повторит её клиенту.
 */
export async function segmentOf(sphereCode: string | null): Promise<string | null> {
    if (!sphereCode) return null;
    const { data } = await supabase
        .from('sales_segment_map')
        .select('segment')
        .eq('sphere_code', sphereCode)
        .maybeSingle();
    return data?.segment ?? null;
}

export async function loadSolutionRules(ownCategories: string[], segment: string | null): Promise<SolutionRule[]> {
    // Без сегмента правил не даём: товар одинаковый у многих, а задача разная.
    // Энергетик, купивший сушильный шкаф, получал совет про скамейки в
    // раздевалку детского сада — потому что триггер совпадал.
    if (ownCategories.length === 0 || !segment) return [];
    const { data } = await supabase
        .from('sales_solution_map')
        .select('segment, trigger_item, offer_item, need_reason, availability')
        .eq('state', 'confirmed')
        .eq('segment', segment)
        .in('trigger_item', ownCategories);

    return ((data ?? []) as any[])
        .filter((r) => r.availability !== 'не делаем')
        // Предлагать то, что клиент и так берёт, — потерянный совет.
        .filter((r) => !ownCategories.includes(r.offer_item))
        .map((r) => ({
            segment: r.segment,
            trigger: r.trigger_item,
            offer: r.offer_item,
            why: r.need_reason,
            availability: r.availability,
        }));
}

async function catalogCategories(): Promise<string[]> {
    const { data } = await supabase
        .from('sales_category_rule')
        .select('category, ordinal')
        .order('ordinal');
    const all = ((data ?? []) as any[])
        .map((r) => r.category)
        .filter((c: string) => !['Доставка', 'Аттестация'].includes(c));
    return Array.from(new Set(all));
}

/**
 * Проверка ответа модели кодом — третий рубеж после промпта и списка категорий.
 *
 * Проверено на живом разборе: получив каталог из трёх категорий, модель
 * предложила четвёртую, которой в списке не было. Промпт запрещал, а она всё
 * равно назвала — и это нормальное поведение модели, ненормально было бы на неё
 * положиться. Рекомендация, не опирающаяся ни на одну нашу категорию,
 * отбрасывается: пусть менеджер лучше получит строку без подсказки, чем повод
 * пообещать клиенту то, чего мы не делаем.
 */
export function mentionsCatalog(insight: Insight, catalog: string[]): boolean {
    const text = `${insight.opportunity} ${insight.talkTrack}`.toLowerCase();
    return catalog.some((c) => {
        // Сравниваем по корню слова: «сушильные стеллажи» в тексте склоняются.
        const root = c.toLowerCase().split(' ')[0].slice(0, Math.max(4, c.length - 3));
        return text.includes(root);
    });
}

/**
 * Разбор клиента моделью. Кэш по отпечатку досье.
 *
 * Мягкая деградация: нет OpenAI, нет промпта, модель ответила не тем — вернётся
 * null, и в сообщении просто не будет строки от аналитика. Блок развития
 * работает и без него: код всё равно назвал клиента и категории.
 */
export async function analyzeClient(clientKey: string, opts: { force?: boolean } = {}): Promise<Insight | null> {
    if (!isOpenAIConfigured()) return null;

    const dossier = await loadDossier(clientKey);
    if (!dossier) return null;
    const fingerprint = dossierFingerprint(dossier);

    if (!opts.force) {
        const { data: cached } = await supabase
            .from('sales_client_insight')
            .select('*')
            .eq('client_key', clientKey)
            .maybeSingle();
        if (cached && cached.dossier_fingerprint === fingerprint) {
            return {
                opportunity: cached.opportunity,
                talkTrack: cached.talk_track,
                evidence: cached.evidence,
                caution: cached.caution,
            };
        }
    }

    const { data: prompt } = await supabase
        .from('ai_prompts')
        .select('system_prompt, model, temperature, max_tokens')
        .eq('key', 'sales_client_analyst')
        .eq('is_active', true)
        .maybeSingle();
    if (!prompt) return null;

    const catalog = await catalogCategories();
    const segment = await segmentOf(dossier.sphereCode);
    const rules = await loadSolutionRules(Object.keys(dossier.byCategory), segment);

    // Нет правил — молчим. Без карты модель выдаёт «предложите ещё сушильные
    // шкафы тому, кто их и так берёт»: формально верно, для менеджера пусто.
    // У перекупщиков и торгующих организаций сегмента нет намеренно — их задача
    // не своя, а заказчика, и угадывать её нельзя.
    if (rules.length === 0) return null;

    const text = renderDossier(dossier, catalog, rules);

    try {
        const openai = getOpenAIClient();
        const completion = await openai.chat.completions.create({
            model: prompt.model || 'gpt-4o-mini',
            temperature: Number(prompt.temperature ?? 0.4),
            max_tokens: Number(prompt.max_tokens ?? 600),
            response_format: { type: 'json_object' },
            messages: [
                { role: 'system', content: prompt.system_prompt },
                { role: 'user', content: text },
            ],
        });

        await recordAiUsage({
            agentId: AiAgent.SALES_ANALYST,
            model: completion.model,
            usage: completion.usage,
            purpose: 'sales_client_analyst',
        }).catch(() => null);

        const raw = completion.choices[0]?.message?.content;
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        const insight: Insight = {
            opportunity: String(parsed.opportunity ?? '').trim(),
            talkTrack: String(parsed.talk_track ?? '').trim(),
            evidence: String(parsed.evidence ?? '').trim(),
            caution: String(parsed.caution ?? '').trim(),
        };
        if (!insight.opportunity) return null;
        // Есть карта — совет обязан опираться на неё, а не на общие соображения:
        // ради этого карта и составлялась.
        const allowed = rules.length > 0 ? rules.map((r) => r.offer) : catalog;
        if (!mentionsCatalog(insight, allowed)) return null;

        await supabase.from('sales_client_insight').upsert({
            client_key: clientKey,
            client_name: dossier.clientName,
            opportunity: insight.opportunity,
            talk_track: insight.talkTrack,
            evidence: insight.evidence,
            caution: insight.caution,
            model: completion.model,
            dossier_fingerprint: fingerprint,
            generated_at: new Date().toISOString(),
        });

        return insight;
    } catch {
        // Разбор клиента — приправа, а не основа: без него план на день остаётся
        // полным, поэтому сбой модели не должен ронять утреннюю рассылку.
        return null;
    }
}
