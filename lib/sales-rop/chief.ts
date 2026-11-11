import { supabase } from '@/utils/supabase';
import { getOpenAIClient, isOpenAIConfigured } from '@/utils/openai';
import { AiAgent, recordAiUsage } from '@/lib/ai-usage';
import { formatRub } from '@/lib/format';
import { longPlayTasks, ownTasks, taskBlock, taskKey, type DayCapacity, type Task } from '@/lib/sales-rop/rules';
import { memoryLine, type TaskMemory } from '@/lib/sales-rop/memory';

/**
 * РОП решает день.
 *
 * Как было. План собирал код целиком: отбирал кандидатов, резал нормой и
 * сортировал, а модель лишь подписывала к готовой строке «о чём говорить».
 * Руководителя в этом не было ни на одном шаге, и видно это было по данным:
 * один и тот же клиент приходил в план 32 дня подряд, разговор случался в 3%
 * задач, а услышанный отказ не влиял ни на что, кроме одного блока.
 *
 * Как стало — три слоя, и границы между ними жёсткие:
 *
 *   1. Факты (код). Собирает пул кандидатов и к каждому — цифры и память: что
 *      покупал, сколько молчим, сколько раз уже ставили, чем кончилось.
 *   2. Решение (модель, один вызов на менеджера в сутки). Из пула выбирает
 *      день: что брать, в каком порядке, с какой целью, о чём спросить, и кого
 *      отложить и на сколько.
 *   3. Применение (код). Пишет задачи, двигает ритм и держит сторожей: работу
 *      не из пула не принимает, норму дня превысить не даёт, дату назад не
 *      сдвигает, у каждой строки хранит, почему она здесь.
 *
 * Чисел модель не считает и портить их не может: суммы, сроки и давность
 * приходят к ней готовыми и в ответе не участвуют.
 */

/** Задание по одной работе: не напоминание, а что сделать и зачем. */
export type ChiefAssignment = {
    /** Чем день по этой работе должен кончиться. */
    goal: string;
    /** Что сделать сейчас: одно действие. */
    action: string;
    /** О чём спросить клиента. Пусто — вопроса нет. */
    ask: string;
};

export type ChiefPostpone = {
    key: string;
    days: number;
    why: string;
};

export type ChiefDecision = {
    tasks: Array<{ key: string } & ChiefAssignment>;
    postpone: ChiefPostpone[];
    /** Одна фраза менеджеру про весь день. Пусто — обойдёмся своим текстом. */
    note: string;
};

export type ChiefLimits = {
    /** Сколько живых задач влезает в день (норма минус своё и заявки). */
    live: number;
    /** Сколько работы вдолгую даём в день. */
    longPlay: number;
    /** Минимум задач, который приходит всегда. */
    minAlways: number;
    /** Насколько далеко РОПу позволено отложить клиента. */
    maxPostponeDays: number;
};

export type ChiefResult = {
    /** Задачи дня в порядке, который назначил РОП. */
    tasks: Task[];
    /** Задание по каждой задаче, ключ — taskKey. */
    assignments: Map<string, ChiefAssignment>;
    postpone: Array<{ task: Task; days: number; why: string }>;
    note: string;
    /** Что сторожа не пропустили. Пишется в лог решения и видно человеку. */
    violations: string[];
};

/** Разобрать ответ модели. Поломка ответа не должна ронять утро целиком. */
export function parseChiefDecision(raw: string): ChiefDecision | null {
    let parsed: any;
    try {
        parsed = JSON.parse(raw);
    } catch {
        return null;
    }
    if (!parsed || typeof parsed !== 'object') return null;

    const tasks: ChiefDecision['tasks'] = [];
    for (const item of Array.isArray(parsed['план']) ? parsed['план'] : []) {
        if (!item || typeof item !== 'object') continue;
        const key = String(item['ключ'] ?? '').trim();
        const action = String(item['что_сделать'] ?? '').trim();
        // Без ключа работу не опознать, без действия задание не задание.
        if (!key || !action) continue;
        tasks.push({
            key,
            goal: String(item['цель'] ?? '').trim(),
            action,
            ask: String(item['о_чём_спросить'] ?? '').trim(),
        });
    }

    const postpone: ChiefPostpone[] = [];
    for (const item of Array.isArray(parsed['отложить']) ? parsed['отложить'] : []) {
        if (!item || typeof item !== 'object') continue;
        const key = String(item['ключ'] ?? '').trim();
        const days = Number(item['дней']);
        const why = String(item['почему'] ?? '').trim();
        // Решение без основания непроверяемо, а значит и неприменимо: по этим
        // словам человек потом смотрит, прав ли был РОП.
        if (!key || !Number.isFinite(days) || !why) continue;
        postpone.push({ key, days: Math.round(days), why });
    }

    return { tasks, postpone, note: String(parsed['записка'] ?? '').trim() };
}

/**
 * Сторожа над решением РОПа.
 *
 * Чистая функция: на вход пул и ответ модели, на выход — день, который можно
 * отдать человеку. Всё, что модель выдумала или нарушила, не применяется и
 * называется вслух.
 */
export function applyChiefDecision(params: {
    pool: Task[];
    decision: ChiefDecision;
    limits: ChiefLimits;
}): ChiefResult {
    const { pool, decision, limits } = params;
    const byKey = new Map(pool.map((t) => [taskKey(t), t]));
    const violations: string[] = [];
    const assignments = new Map<string, ChiefAssignment>();

    // Собственные звонки менеджера входят в день всегда: это обещания, данные
    // клиентам, и отменять их РОП не вправе — ни бот, ни человек.
    const own = ownTasks(pool);
    const ownKeys = new Set(own.map(taskKey));

    const live: Task[] = [];
    const longPlay: Task[] = [];
    const seen = new Set<string>();
    for (const item of decision.tasks) {
        const task = byKey.get(item.key);
        if (!task) {
            violations.push(`работы «${item.key}» в пуле не было — не взял`);
            continue;
        }
        if (seen.has(item.key)) continue;
        seen.add(item.key);
        assignments.set(item.key, { goal: item.goal, action: item.action, ask: item.ask });
        if (ownKeys.has(item.key)) continue;
        if (taskBlock(task.reasonCode) === 'development') longPlay.push(task);
        else live.push(task);
    }

    // Норму дня превысить нельзя: список, который заведомо не сделать, не
    // выполняют весь, а не частично.
    if (live.length > limits.live) {
        violations.push(`живых задач ${live.length} — оставил ${limits.live} по норме дня`);
        live.length = limits.live;
    }
    if (longPlay.length > limits.longPlay) {
        violations.push(`работы вдолгую ${longPlay.length} — оставил ${limits.longPlay} по норме`);
        longPlay.length = limits.longPlay;
    }

    // Недогруз — такая же потеря, как перегруз: добираем по правилам, сверху
    // пула. Пустой день бот присылать не должен.
    const chosen = new Set([...own, ...live, ...longPlay].map(taskKey));
    if (live.length + own.length < limits.minAlways) {
        const need = limits.minAlways - live.length - own.length;
        const extra = pool
            .filter((t) => !chosen.has(taskKey(t)) && taskBlock(t.reasonCode) === 'active')
            .slice(0, Math.max(0, Math.min(need, limits.live - live.length)));
        if (extra.length > 0) {
            violations.push(`РОП дал мало задач — добрал ${extra.length} по правилам`);
            live.push(...extra);
            for (const t of extra) chosen.add(taskKey(t));
        }
    }

    const postpone: ChiefResult['postpone'] = [];
    for (const item of decision.postpone) {
        const task = byKey.get(item.key);
        if (!task) {
            violations.push(`отложить «${item.key}» нельзя: такой работы в пуле нет`);
            continue;
        }
        // Живую сделку отложить нельзя: висящий счёт и просроченное обещание —
        // это деньги и слово, данное клиенту, а не ритм общения.
        if (taskBlock(task.reasonCode) !== 'development') {
            violations.push(`${task.client}: живую сделку (${task.statusName}) откладывать не дал`);
            continue;
        }
        if (item.days < 1 || item.days > limits.maxPostponeDays) {
            violations.push(`${task.client}: отсрочку ${item.days} дн. не дал, предел ${limits.maxPostponeDays}`);
            continue;
        }
        postpone.push({ task, days: item.days, why: item.why });
    }

    // Порядок блоков — закон владельца: сначала то, что в работе, потом работа
    // вдолгую. Внутри блока порядок назначил РОП.
    return { tasks: [...own, ...live, ...longPlay], assignments, postpone, note: decision.note, violations };
}

/**
 * Строка пула для брифа: факты и память, без выводов.
 *
 * Повод обрезаем до первой строки. Дальше в нём лежит совет старого советника
 * («предложите верстаки…»), а это чужое мнение, которое РОПу решать не
 * помогает: своё задание он напишет сам. На трёх менеджерах этот хвост давал
 * 23 тысячи токенов входа из 34 тысяч знаков брифа.
 */
export function poolLine(task: Task, memory?: TaskMemory): string {
    const reason = String(task.reasonText ?? '').split('\n')[0].trim();
    const head = task.number ? `заказ №${task.number} | ` : '';
    const parts = [
        `${taskKey(task)} | ${task.client} | ${head}${formatRub(task.amount)} | ${task.statusName}`,
        `повод: ${reason}`,
    ];
    const mem = memoryLine(memory);
    if (mem) parts.push(`история: ${mem}`);
    return parts.join('\n   ');
}

/** Что РОП знает про день менеджера, прежде чем решать. */
export type ChiefBrief = {
    managerName: string;
    today: string;
    pool: Task[];
    memory: Map<number, TaskMemory>;
    capacity: DayCapacity;
    limits: ChiefLimits;
    /** План месяца и факт по этому менеджеру, если известны. */
    monthPlan?: { plan: number; fact: number } | null;
};

/**
 * Бриф РОПу.
 *
 * Рамки дня и пул работы разведены жёстко: в первом прогоне модель приняла
 * строки «собственные звонки» и «разбор новых заявок» за позиции пула и
 * попыталась поставить их в план как работу. Сторожа их не пропустили, но
 * причина была в тексте, а не в модели.
 */
export function renderChiefBrief(b: ChiefBrief): string {
    const own = ownTasks(b.pool);
    const active = b.pool.filter((t) => taskBlock(t.reasonCode) === 'active' && t.reasonCode !== 'contact_today');
    const long = longPlayTasks(b.pool);

    const lines: string[] = [
        `Менеджер: ${b.managerName}. День: ${b.today.split('-').reverse().join('.')}`,
        '',
        '--- РАМКИ ДНЯ (условия, а не работа: в план их не ставят) ---',
        `Норма дня — ${b.capacity.dailyTarget} дел.`,
        `Из них ${own.length} уже заняты собственными звонками менеджера и ${b.capacity.intake} — разбором новых заявок, которые придут в течение дня.`,
        'Собственные звонки входят в день всегда и отложить их нельзя: это обещания, данные клиентам. Задание по ним дать нужно.',
        `Из пула можно взять: живых сделок до ${b.limits.live}, работы вдолгую до ${b.limits.longPlay}. Меньше ${b.limits.minAlways} задач день не бывает.`,
        `Отложить можно только работу вдолгую и не дальше ${b.limits.maxPostponeDays} дней.`,
    ];
    if (b.monthPlan && b.monthPlan.plan > 0) {
        lines.push(`План месяца: ${formatRub(b.monthPlan.plan)}, сделано ${formatRub(b.monthPlan.fact)}.`);
    }

    lines.push(
        '',
        '--- ПУЛ РАБОТЫ: выбирать только отсюда ---',
        'Ключ — первое поле строки. Работы с другим ключом не существует.',
    );

    if (own.length > 0) {
        lines.push('', `СОБСТВЕННЫЕ ЗВОНКИ МЕНЕДЖЕРА НА СЕГОДНЯ (${own.length}, входят в день):`);
        for (const t of own) lines.push(` • ${poolLine(t, b.memory.get(t.orderId))}`);
    }
    lines.push('', `ЖИВЫЕ СДЕЛКИ (${active.length}):`);
    for (const t of active) lines.push(` • ${poolLine(t, b.memory.get(t.orderId))}`);
    lines.push('', `РАБОТА ВДОЛГУЮ (${long.length}):`);
    for (const t of long) lines.push(` • ${poolLine(t, b.memory.get(t.orderId))}`);

    return lines.join('\n');
}

/**
 * Решение РОПа на день: один вызов модели на менеджера.
 *
 * Мягкая деградация на каждом шаге: нет ключа OpenAI, нет промпта, ответ не
 * разобрался — вернётся null, и день соберётся правилами, как раньше. План
 * важнее того, кто его составил.
 */
export async function decideDay(
    b: ChiefBrief,
): Promise<{ decision: ChiefDecision; model: string; brief: string } | null> {
    if (!isOpenAIConfigured()) return null;
    if (b.pool.length === 0) return null;

    const { data: prompt } = await supabase
        .from('ai_prompts')
        .select('system_prompt, model, temperature, max_tokens')
        .eq('key', 'sales_rop_chief')
        .eq('is_active', true)
        .maybeSingle();
    if (!prompt) return null;

    const brief = renderChiefBrief(b);
    try {
        const openai = getOpenAIClient();
        const completion = await openai.chat.completions.create({
            model: prompt.model || 'gpt-4o',
            temperature: Number(prompt.temperature ?? 0.2),
            max_tokens: Number(prompt.max_tokens ?? 2000),
            response_format: { type: 'json_object' },
            messages: [
                { role: 'system', content: prompt.system_prompt },
                { role: 'user', content: brief },
            ],
        });

        // Расход пишем на тот же агент, что и остальные вызовы бота-РОПа:
        // «Семён» и прочие персоны тут не при чём, это один и тот же Роман.
        await recordAiUsage({
            agentId: AiAgent.SALES_ANALYST,
            model: completion.model,
            usage: completion.usage,
            purpose: 'sales_rop_chief',
        }).catch(() => null);

        const raw = completion.choices[0]?.message?.content;
        if (!raw) return null;
        const decision = parseChiefDecision(raw);
        if (!decision || decision.tasks.length === 0) return null;
        return { decision, model: completion.model, brief };
    } catch {
        return null;
    }
}

/**
 * Применить отсрочки: сдвинуть ритм общения с клиентом.
 *
 * Пишем туда же, куда пишет услышанный отказ, — в снимок отношений. Назад дату
 * не двигаем никогда: закон о неприкосновенной дате контакта сильнее сегодняшнего
 * решения, кто-то мог назначить разговор раньше нашего.
 */
export async function applyChiefPostpones(
    postpone: ChiefResult['postpone'],
    today: string,
    opts: { dryRun?: boolean } = {},
): Promise<Array<{ client: string; until: string | null; skipped: string | null }>> {
    const out: Array<{ client: string; until: string | null; skipped: string | null }> = [];
    for (const item of postpone) {
        const { data: row } = await supabase
            .from('sales_client_relation')
            .select('client_key, client_name, next_contact_at')
            .eq('last_order_id', item.task.orderId)
            .maybeSingle();
        if (!row) {
            out.push({ client: item.task.client, until: null, skipped: 'клиента в отношениях не нашли' });
            continue;
        }
        const next = new Date(`${today}T00:00:00Z`);
        next.setUTCDate(next.getUTCDate() + item.days);
        const until = next.toISOString().slice(0, 10);
        const already = (row as any).next_contact_at ? String((row as any).next_contact_at).slice(0, 10) : null;
        if (already && already >= until) {
            out.push({ client: String((row as any).client_name ?? item.task.client), until: already, skipped: 'дата уже дальше' });
            continue;
        }
        if (!opts.dryRun) {
            await supabase
                .from('sales_client_relation')
                .update({ next_contact_at: until })
                .eq('client_key', (row as any).client_key);
        }
        out.push({ client: String((row as any).client_name ?? item.task.client), until, skipped: null });
    }
    return out;
}

/** Решение в журнал: по нему потом видно, что РОП решил и что сторожа срезали. */
export async function logChiefDecision(params: {
    today: string;
    managerId: number | null;
    poolSize: number;
    model: string;
    decision: ChiefDecision;
    result: ChiefResult;
    applied: boolean;
}): Promise<void> {
    const { error } = await supabase.from('sales_rop_chief_decision').upsert(
        {
            plan_date: params.today,
            manager_id: params.managerId,
            pool_size: params.poolSize,
            model: params.model,
            decision: params.decision as any,
            taken: params.result.tasks.map((t) => taskKey(t)),
            violations: params.result.violations,
            applied: params.applied,
        },
        { onConflict: 'plan_date,manager_id' },
    );
    if (error) console.warn('[sales-rop] Решение РОПа не записалось:', error.message);
}
