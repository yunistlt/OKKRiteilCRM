import { createHash } from 'node:crypto';
import { supabase } from '@/utils/supabase';
import { getOpenAIClient, isOpenAIConfigured } from '@/utils/openai';
import { AiAgent, recordAiUsage } from '@/lib/ai-usage';
import { catalogCategories, loadDossier, loadSolutionRules, renderDossier, segmentOf } from '@/lib/sales-rop/analyst';
import type { Task } from '@/lib/sales-rop/rules';

/**
 * Что сделать по этому заказу сегодня, почему именно это и что предложить.
 *
 * Зачем. Строка «№54441 — 340 000 ₽ — ООО Ромашка / Счёт висит 5 дней» не
 * говорит менеджеру ничего, чего он не знает. За шестьдесят дней из 710 таких
 * задач в производство ушло двадцать заказов, а в отмену — восемьдесят девять,
 * причём половину закрыли, ни разу не поговорив с клиентом. Список без смысла
 * разгребают, а не отрабатывают.
 *
 * Отличие от разбора клиента (analyst.ts): тот отвечает «что ещё продать
 * ЭТОМУ КЛИЕНТУ» и молчит, если карты решений для его сегмента нет. Здесь
 * вопрос другой — «что сделать с ЭТИМ ЗАКАЗОМ сегодня», и ответ на него есть
 * всегда: у заказа есть причина попадания в план, срок, статус и история
 * разговоров. Кросс-продажа — приятное дополнение, а не условие совета.
 *
 * Граница слоёв та же: код решает, ЧТО брать в план и КОМУ отдать, модель — о
 * чём говорить. Чисел модель не считает и портить их не может.
 */

export type TaskAdvice = {
    /** Что сделать: одно конкретное действие, а не «проработать клиента». */
    action: string;
    /** Почему именно это — основание из истории заказа. */
    why: string;
    /** Что предложить сверх текущего заказа. Пусто — значит нечего. */
    offer: string;
};

/** Что модель должна знать о самом заказе, помимо клиента. */
export type OrderContext = {
    number: string;
    amount: number;
    statusName: string;
    daysInStatus: number | null;
    /** Последние комментарии менеджера по заказу. */
    comments: string[];
    /** Был ли разговор и когда. */
    lastCallAt: string | null;
    callsCount: number;
    /** Расшифровка последнего разговора именно по этому заказу. */
    lastTranscript: string | null;
};

const REASON_BRIEF: Record<Task['reasonCode'], string> = {
    invoice_stale: 'Счёт выставлен и не оплачен. Деньги ближе всего именно здесь: клиент уже согласился на цену.',
    contact_overdue: 'Менеджер обещал связаться и не связался. Просрочено обещание, данное клиенту.',
    contact_today: 'Менеджер сам поставил контакт на сегодня.',
    deal_stale: 'Сделка не двигается. Причина остановки из карточки неизвестна.',
    big_silence: 'Крупная сделка молчит дольше обычного.',
    cold: 'Заказ давно остыл. Решение: поднять или честно закрыть, узнав причину у клиента.',
    development: 'Клиент покупал раньше. Повод — не сделка, а следующая покупка.',
    reactivation: 'Клиент давно не покупал. Задача — узнать, что изменилось, и вернуться в поле зрения.',
    client_touch: 'Давно не общались. Отношения, а не сделка.',
    cancel_unconfirmed:
        'Заказ закрыли, не поговорив с клиентом. Задача — выяснить у него настоящую причину: '
        + 'решение могло измениться, а закрытый молча заказ это клиент, о котором мы не знаем, почему он ушёл.',
};

export function adviceFingerprint(task: Task, ctx: OrderContext): string {
    // В отпечаток идёт то, от чего меняется совет: причина, статус, срок,
    // число комментариев и звонков. Сумма и имя клиента совет не двигают.
    return createHash('sha256')
        .update(
            JSON.stringify([
                task.reasonCode,
                task.statusCode,
                ctx.daysInStatus,
                ctx.comments.length,
                ctx.callsCount,
                ctx.lastCallAt,
            ]),
        )
        .digest('hex')
        .slice(0, 16);
}

/** Состояние заказа: комментарии, звонки, расшифровка последнего разговора. */
export async function loadOrderContext(task: Task): Promise<OrderContext> {
    const [{ data: order }, { data: history }, { data: matches }] = await Promise.all([
        supabase.from('orders').select('number, status, total_summ, updated_at, raw_payload').eq('id', task.orderId).maybeSingle(),
        supabase
            .from('order_history_log')
            .select('field, new_value, occurred_at')
            .eq('retailcrm_order_id', task.orderId)
            .order('occurred_at', { ascending: false })
            .limit(30),
        // Звонки по заказу — через общую связь: привязка из RetailCRM, наш
        // матчинг запасной. Сортировка по времени разговора, а не по времени
        // сопоставления: второе отстаёт, иногда на несколько суток.
        supabase
            .from('call_order_link')
            .select('telphin_call_id, started_at')
            .eq('order_id', task.orderId)
            .order('started_at', { ascending: false })
            .limit(10),
    ]);

    // Комментарии менеджера — то, что он сам писал о заказе. Это единственное
    // место, где видно его версию происходящего.
    const comments: string[] = [];
    for (const row of (history ?? []) as any[]) {
        if (row.field !== 'manager_comment' && row.field !== 'customer_comment') continue;
        const value = typeof row.new_value === 'string' ? row.new_value : JSON.stringify(row.new_value ?? '');
        const text = value.replace(/^"|"$/g, '').trim();
        if (text && text !== 'null') comments.push(text);
        if (comments.length >= 5) break;
    }

    let daysInStatus: number | null = null;
    for (const row of (history ?? []) as any[]) {
        if (row.field !== 'status') continue;
        daysInStatus = Math.floor((Date.now() - new Date(row.occurred_at).getTime()) / 86_400_000);
        break;
    }

    const callIds = ((matches ?? []) as any[]).map((m) => m.telphin_call_id).filter(Boolean);
    let lastCallAt: string | null = null;
    let lastTranscript: string | null = null;
    if (callIds.length > 0) {
        const { data: calls } = await supabase
            .from('raw_telphin_calls')
            .select('started_at, transcript')
            .in('telphin_call_id', callIds)
            .order('started_at', { ascending: false })
            .limit(3);
        const rows = (calls ?? []) as any[];
        lastCallAt = rows[0]?.started_at ?? null;
        // Расшифровка берётся у самого свежего разговора, у которого она есть:
        // расшифрованы не все звонки, и «нет расшифровки» не значит «не звонили».
        lastTranscript = rows.find((r) => r.transcript)?.transcript ?? null;
    }

    return {
        number: String(order?.number ?? task.number),
        amount: task.amount,
        statusName: task.statusName,
        daysInStatus,
        comments,
        lastCallAt,
        callsCount: callIds.length,
        lastTranscript,
    };
}

/** Текст для модели: заказ, его история, клиент и чем оснащаются похожие. */
export function renderTaskBrief(
    task: Task,
    ctx: OrderContext,
    dossierText: string | null,
    similar: Array<{ category: string; clients: number }> = [],
): string {
    const money = (v: number) => Math.round(v).toLocaleString('ru-RU');
    const lines = [
        `ЗАКАЗ №${ctx.number} на ${money(ctx.amount)} ₽`,
        `Клиент: ${task.client || 'не указан'}`,
        `Статус: ${ctx.statusName}${ctx.daysInStatus !== null ? ` (в нём ${ctx.daysInStatus} дн.)` : ''}`,
        `Почему заказ в плане на сегодня: ${REASON_BRIEF[task.reasonCode]}`,
        `Что записал код: ${task.reasonText.split('\n')[0]}`,
    ];

    if (ctx.callsCount > 0) {
        lines.push(
            `Разговоров по заказу: ${ctx.callsCount}` +
                (ctx.lastCallAt ? `, последний ${String(ctx.lastCallAt).slice(0, 10)}` : ''),
        );
    } else {
        lines.push('Разговоров по заказу не зафиксировано. Возможно, звонили с мобильного — утверждать нельзя.');
    }

    if (ctx.comments.length > 0) {
        lines.push('', 'Комментарии менеджера по заказу (свежие сверху):', ...ctx.comments.map((c) => `— ${c}`));
    }
    if (ctx.lastTranscript) {
        // Роли в расшифровке размечены ненадёжно, и модель обязана об этом
        // знать: иначе она уверенно припишет слова клиента менеджеру.
        lines.push(
            '',
            'Расшифровка последнего разговора (кто говорит — размечено ненадёжно, не приписывай реплики по ролям):',
            ctx.lastTranscript.slice(0, 4000),
        );
    }
    if (dossierText) lines.push('', '--- О КЛИЕНТЕ ---', dossierText);

    if (similar.length > 0) {
        lines.push(
            '',
            'Чем оснащаются предприятия той же сферы (сколько таких клиентов брало):',
            ...similar.map((c) => `— ${c.category}: ${c.clients}`),
            'Это основание для вопроса, а не готовое предложение: соседям по отрасли нужно не то же самое.',
        );
    }

    return lines.join('\n');
}

/**
 * Совет по задаче. Кэш по отпечатку состояния заказа.
 *
 * Мягкая деградация во всех местах: нет OpenAI, нет промпта, модель ответила не
 * тем — вернётся null, и строка в плане останется прежней. План на день важнее
 * подсказки к нему.
 */
export async function adviseTask(task: Task, opts: { force?: boolean; clientKey?: string | null } = {}): Promise<TaskAdvice | null> {
    if (!isOpenAIConfigured()) return null;

    let ctx: OrderContext;
    try {
        ctx = await loadOrderContext(task);
    } catch {
        return null;
    }
    const fingerprint = adviceFingerprint(task, ctx);

    if (!opts.force) {
        const { data: cached } = await supabase
            .from('sales_task_advice')
            .select('action, why, offer, fingerprint')
            .eq('order_id', task.orderId)
            .eq('reason_code', task.reasonCode)
            .maybeSingle();
        if (cached && cached.fingerprint === fingerprint) {
            return { action: cached.action, why: cached.why, offer: cached.offer ?? '' };
        }
    }

    const { data: prompt } = await supabase
        .from('ai_prompts')
        .select('system_prompt, model, temperature, max_tokens')
        .eq('key', 'sales_task_advisor')
        .eq('is_active', true)
        .maybeSingle();
    if (!prompt) return null;

    // Досье клиента и карта решений — если есть. Их отсутствие не повод молчать:
    // совет «что сделать с заказом» не требует знания, что ещё ему продать.
    let dossierText: string | null = null;
    let allowedOffers: string[] = [];
    let similar: Array<{ category: string; clients: number }> = [];
    if (opts.clientKey) {
        try {
            const dossier = await loadDossier(opts.clientKey);
            if (dossier) {
                const catalog = await catalogCategories();
                const segment = await segmentOf(dossier.sphereCode);
                const own = Object.keys(dossier.byCategory);
                const rules = await loadSolutionRules(own, segment);
                dossierText = renderDossier(dossier, catalog, rules);
                similar = await similarClientsBuy(dossier.sphereCode, own);

                // Что вообще можно называть вслух: подтверждённая карта решений
                // плюс то, чем оснащаются похожие предприятия. И то и другое —
                // наши категории; выдумать третье модель не сможет.
                allowedOffers = Array.from(
                    new Set([...rules.map((r) => r.offer), ...similar.map((c) => c.category)]),
                ).filter((c) => catalog.includes(c) || rules.some((r) => r.offer === c));
            }
        } catch {
            dossierText = null;
        }
    }

    try {
        const openai = getOpenAIClient();
        const completion = await openai.chat.completions.create({
            model: prompt.model || 'gpt-4o-mini',
            temperature: Number(prompt.temperature ?? 0.3),
            max_tokens: Number(prompt.max_tokens ?? 400),
            response_format: { type: 'json_object' },
            messages: [
                { role: 'system', content: prompt.system_prompt },
                { role: 'user', content: renderTaskBrief(task, ctx, dossierText, similar) },
            ],
        });

        await recordAiUsage({
            agentId: AiAgent.SALES_ANALYST,
            model: completion.model,
            usage: completion.usage,
            purpose: 'sales_task_advisor',
        }).catch(() => null);

        const raw = completion.choices[0]?.message?.content;
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        const advice: TaskAdvice = {
            action: String(parsed.action ?? '').trim(),
            why: String(parsed.why ?? '').trim(),
            offer: String(parsed.offer ?? '').trim(),
        };
        if (!advice.action) return null;

        // Названное вслух проверяем по нашим категориям: без проверки модель
        // советует то, чего мы не делаем, а менеджер повторит это клиенту.
        // Совет «что сделать» при этом остаётся — он про заказ, а не про товар.
        if (advice.offer && (allowedOffers.length === 0 || !mentionsAny(advice.offer, allowedOffers))) {
            advice.offer = '';
        }

        await supabase.from('sales_task_advice').upsert(
            {
                order_id: task.orderId,
                reason_code: task.reasonCode,
                action: advice.action,
                why: advice.why,
                offer: advice.offer || null,
                fingerprint,
                model: completion.model,
                generated_at: new Date().toISOString(),
            },
            { onConflict: 'order_id,reason_code' },
        );

        return advice;
    } catch {
        return null;
    }
}

/**
 * Что берут похожие клиенты — те, кто работает в той же сфере.
 *
 * Карта решений (sales_solution_map) отвечает на вопрос «взял X — нужен Y» и
 * составлена владельцем вручную, поэтому она точнее всего. Но она покрывает не
 * всё, а вопрос «что мы ещё можем им поставлять» имеет смысл всегда. Сфера даёт
 * второе основание: чем оснащают себя такие же предприятия.
 *
 * Это именно основание для РАЗГОВОРА, а не готовое предложение: то, что берут
 * соседи по отрасли, конкретному заводу может быть не нужно. Отсюда и тон —
 * узнать, что им ещё нужно, а не продать список.
 */
export async function similarClientsBuy(
    sphereCode: string | null,
    ownCategories: string[],
): Promise<Array<{ category: string; clients: number }>> {
    if (!sphereCode) return [];
    const { data } = await supabase
        .from('sales_sphere_category_mv')
        .select('category, clients')
        .eq('sphere_code', sphereCode)
        .order('clients', { ascending: false })
        .limit(12);

    const own = new Set(ownCategories);
    return ((data ?? []) as any[])
        // То, что клиент и так берёт, — не новость ни для кого.
        .filter((r) => !own.has(String(r.category)))
        .map((r) => ({ category: String(r.category), clients: Number(r.clients ?? 0) }))
        .slice(0, 6);
}

/**
 * Ключ клиента по заказу — чтобы подтянуть досье и карту решений.
 *
 * Клиент в CRM заведён несколько раз: одно юрлицо приходит с разных почт и
 * телефонов. Канон сводит эти карточки в одну, и покупки считаются по нему, а
 * не по customer.id — иначе постоянный клиент выглядит новым.
 */
export async function clientKeyForOrder(orderId: number): Promise<string | null> {
    const { data: order } = await supabase.from('orders').select('raw_payload').eq('id', orderId).maybeSingle();
    const custId = (order as any)?.raw_payload?.customer?.id;
    if (!custId) return null;
    const { data } = await supabase
        .from('salary_client_canon')
        .select('group_key')
        .eq('cust_id', String(custId))
        .maybeSingle();
    return (data as any)?.group_key ?? null;
}

/** Упоминается ли хоть одна разрешённая категория — по корню слова, текст склоняется. */
export function mentionsAny(text: string, allowed: string[]): boolean {
    const lower = text.toLowerCase();
    return allowed.some((c) => {
        const root = c.toLowerCase().split(' ')[0].slice(0, Math.max(4, c.length - 3));
        return lower.includes(root);
    });
}
