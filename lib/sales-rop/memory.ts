import { supabase } from '@/utils/supabase';

/**
 * Память РОПа: что уже делали по этой работе и чем это кончилось.
 *
 * Зачем. Отбор задач памяти не имел вовсе: кандидат проходил по сумме и
 * давности покупки, поэтому один и тот же клиент приходил в план месяцами. За
 * 36 дней блок развития выдал 396 задач — и всего 34 разных клиента, по 11,6
 * задачи на каждого, а разговор состоялся в 3% случаев. Остальное — переносы
 * даты, то есть работа по кругу: клиент не тронут, задача завтра та же.
 *
 * Решение принимает РОП, и чтобы решать, ему нужно знать историю: сколько раз
 * мы уже ставили эту задачу, дозвонились ли, что ответил клиент. Факты
 * собираются кодом — они уже есть в плане (sales_rop_task) и в результатах дня
 * (sales_rop_task_result), считать их заново не нужно.
 */

/** Чем кончился день по задаче. Словарь уровней из task-result.ts, по-русски. */
export const RESULT_LABEL: Record<string, string> = {
    money_result: 'ушёл в производство',
    order_moved: 'заказ сдвинулся',
    client_replied: 'клиент ответил',
    confirmed_contact: 'был разговор или письмо',
    comment_only: 'только комментарий',
    crm_touched: 'тронули в CRM без разговора',
    closed_lost_unconfirmed: 'закрыт без разговора с клиентом',
    not_touched: 'не тронули',
};

export type TaskMemory = {
    /** Сколько раз эта работа была в плане за окно памяти. */
    plans: number;
    /** Когда ставили в последний раз. */
    lastPlanDate: string | null;
    /** Разговоров и писем по ней за то же окно. */
    calls: number;
    talkSeconds: number;
    emails: number;
    /** Отвечал ли клиент: письмом или в разговоре. */
    replied: boolean;
    /** Сколько раз заказ после задачи двигался по воронке. */
    movements: number;
    /** Чем кончались последние дни, свежее сначала: «06.11 — только комментарий». */
    history: string[];
};

const RU_DATE = (iso: string) => iso.slice(0, 10).split('-').reverse().join('.');

function emptyMemory(): TaskMemory {
    return { plans: 0, lastPlanDate: null, calls: 0, talkSeconds: 0, emails: 0, replied: false, movements: 0, history: [] };
}

/** Запросы к базе идут частями: в один `in (...)` триста заказов не кладём. */
async function inChunks<T>(ids: number[], size: number, run: (part: number[]) => Promise<T[]>): Promise<T[]> {
    const out: T[] = [];
    for (let i = 0; i < ids.length; i += size) {
        out.push(...(await run(ids.slice(i, i + size))));
    }
    return out;
}

/**
 * История работы по заказам за последние `days` дней, не считая сегодня.
 *
 * Клиент без заказа (блок отношений) памяти здесь не имеет: его историю держит
 * снимок отношений, где лежат дата последнего касания и ритм.
 */
export async function loadTaskMemory(
    orderIds: number[],
    opts: { today: string; days?: number },
): Promise<Map<number, TaskMemory>> {
    const ids = Array.from(new Set(orderIds.map((x) => Number(x)).filter((x) => Number.isFinite(x) && x > 0)));
    const memory = new Map<number, TaskMemory>();
    if (ids.length === 0) return memory;

    const from = new Date(`${opts.today}T00:00:00Z`);
    from.setUTCDate(from.getUTCDate() - Math.max(1, opts.days ?? 30));
    const since = from.toISOString().slice(0, 10);

    const tasks = await inChunks(ids, 200, async (part) => {
        const { data } = await supabase
            .from('sales_rop_task')
            .select('plan_date, order_id')
            .in('order_id', part)
            .gte('plan_date', since)
            .lt('plan_date', opts.today);
        return (data ?? []) as any[];
    });

    for (const row of tasks) {
        const id = Number(row.order_id);
        const m = memory.get(id) ?? emptyMemory();
        m.plans += 1;
        const date = String(row.plan_date).slice(0, 10);
        if (!m.lastPlanDate || date > m.lastPlanDate) m.lastPlanDate = date;
        memory.set(id, m);
    }

    const results = await inChunks(ids, 200, async (part) => {
        const { data } = await supabase
            .from('sales_rop_task_result')
            .select('plan_date, order_id, calls_count, call_seconds, emails_count, client_replied, movement_type, result_status')
            .in('order_id', part)
            .gte('plan_date', since)
            .lt('plan_date', opts.today)
            .order('plan_date', { ascending: false });
        return (data ?? []) as any[];
    });

    for (const row of results) {
        const id = Number(row.order_id);
        const m = memory.get(id) ?? emptyMemory();
        m.calls += Number(row.calls_count ?? 0);
        m.talkSeconds += Number(row.call_seconds ?? 0);
        m.emails += Number(row.emails_count ?? 0);
        if (row.client_replied) m.replied = true;
        if (row.movement_type) m.movements += 1;
        // Три последних дня: длиннее история решения не меняет, а брифу стоит
        // места. Свежее сначала — именно так её читает человек.
        if (m.history.length < 3) {
            const label = RESULT_LABEL[String(row.result_status)] ?? String(row.result_status);
            m.history.push(`${RU_DATE(String(row.plan_date))} — ${label}`);
        }
        memory.set(id, m);
    }

    return memory;
}

/**
 * Память одной строкой — так она идёт в бриф РОПу.
 *
 * Пусто — значит эту работу мы сегодня ставим впервые за окно памяти, и писать
 * об этом нечего: отсутствие истории само по себе не факт.
 */
export function memoryLine(m: TaskMemory | undefined): string {
    if (!m || m.plans === 0) return '';
    const parts = [`в плане ${m.plans} раз`];
    if (m.lastPlanDate) parts.push(`последний ${RU_DATE(m.lastPlanDate)}`);
    parts.push(m.calls > 0 ? `разговоров ${m.calls}` : 'разговора не было ни разу');
    if (m.emails > 0) parts.push(`писем ${m.emails}`);
    if (m.replied) parts.push('клиент отвечал');
    if (m.movements > 0) parts.push(`заказ двигался ${m.movements} раз`);
    const tail = m.history.length > 0 ? `; итоги: ${m.history.join(', ')}` : '';
    return `${parts.join(', ')}${tail}`;
}
