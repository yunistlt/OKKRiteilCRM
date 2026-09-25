import { supabase } from '@/utils/supabase';

/**
 * Что на самом деле случилось с задачами дня.
 *
 * Отметки «тронуто» не хватало: комментарий в карточке и разговор с клиентом
 * считались одинаково, а это разные вещи. Комментарий менеджер пишет сам о
 * себе; звонок, письмо и ответ клиента — след, оставленный кем-то ещё.
 *
 * Цепочка одна для любой задачи, и уровень — самая высокая достигнутая ступень:
 *
 *   0 выдана, не тронута
 *   1 тронута в карточке (в том числе только комментарием)
 *   2 подтверждённый контакт: звонок или письмо
 *   3 клиент ответил: входящий звонок или входящее письмо
 *   4 заказ сдвинулся по воронке
 *   5 деньги: счёт или уход в производство
 *
 * Чего здесь намеренно нет — общего балла. Один рейтинг из нагрузки, активности
 * и результата врёт: у одного крупные сделки и три длинных разговора в день, у
 * другого поток мелких. Складывать это в одно число значит сравнивать разное.
 */

export type TaskResultRow = {
    plan_date: string;
    order_id: number;
    manager_id: number | null;
    reason_code: string | null;
    amount: number;
    touched: boolean;
    touch_kind: string | null;
    calls_count: number;
    call_seconds: number;
    call_first_at: string | null;
    emails_count: number;
    /** Откуда взята привязка звонка к заказу: 'crm' или 'match'. */
    call_source: string | null;
    client_replied: boolean;
    client_reply_at: string | null;
    movement_type: string | null;
    movement_at: string | null;
    money_type: string | null;
    money_amount: number | null;
    money_at: string | null;
    result_level: number;
    result_status: string;
    details: Record<string, unknown>;
};

/** Статусы, означающие «заказ ушёл в производство» — по ним же считается зарплата. */
const PRODUCTION_STATUSES = ['send-assembling', 'zagruzen-systemu'];

/**
 * Схлопывание звонков.
 *
 * Один разговор через очередь даёт несколько строк телефонии: очередь звонит
 * нескольким сразу, и каждая попытка записывается отдельно. Без схлопывания
 * активность выглядит втрое выше, чем была.
 */
export function collapseCalls(
    calls: Array<{ started_at: string; duration_sec: number | null; from_number: string; to_number: string }>,
): Array<{ started_at: string; duration_sec: number }> {
    const sorted = [...calls].sort((a, b) => a.started_at.localeCompare(b.started_at));
    const out: Array<{ started_at: string; duration_sec: number }> = [];

    for (const call of sorted) {
        const prev = out[out.length - 1];
        const gapMs = prev ? new Date(call.started_at).getTime() - new Date(prev.started_at).getTime() : Infinity;
        // Две минуты — окно одного разговора: попытки дозвона внутри очереди
        // укладываются в него, а следующий самостоятельный звонок уже нет.
        if (prev && gapMs < 2 * 60_000) {
            // Из попыток берём самую длинную: именно она была разговором.
            prev.duration_sec = Math.max(prev.duration_sec, Number(call.duration_sec ?? 0));
            continue;
        }
        out.push({ started_at: call.started_at, duration_sec: Number(call.duration_sec ?? 0) });
    }
    return out;
}

/** Уровень и название по собранным фактам. */
export function levelOf(row: Omit<TaskResultRow, 'result_level' | 'result_status'>): {
    level: number;
    status: string;
} {
    if (row.money_type) return { level: 5, status: 'money_result' };
    if (row.movement_type) {
        // Заказ «сдвинулся» в отмену, и разговора с клиентом не было — это не
        // результат, а потерянный клиент, о котором мы не знаем, почему он ушёл.
        if (row.movement_type === 'lost' && row.calls_count === 0 && row.emails_count === 0) {
            return { level: 1, status: 'closed_lost_unconfirmed' };
        }
        return { level: 4, status: 'order_moved' };
    }
    if (row.client_replied) return { level: 3, status: 'client_replied' };
    if (row.calls_count > 0 || row.emails_count > 0) return { level: 2, status: 'confirmed_contact' };
    if (row.touched) {
        // Тронули, но внешнего следа нет. Комментарий отделяем от смены статуса:
        // первое — запись о работе, второе хотя бы двигает заказ.
        return { level: 1, status: row.touch_kind === 'комментарий' ? 'comment_only' : 'crm_touched' };
    }
    return { level: 0, status: 'not_touched' };
}

/**
 * Посчитать результаты по всем задачам дня и записать их.
 *
 * Считается вечером, после того как день закончился. Пересчёт того же дня
 * безопасен: строки переписываются по ключу «дата + заказ».
 */
export async function computeTaskResults(date: string): Promise<{ rows: number; byStatus: Record<string, number> }> {
    const { data: tasks, error } = await supabase
        .from('sales_rop_task')
        .select('order_id, order_number, manager_id, reason_code, amount, touched, touch_kind')
        .eq('plan_date', date);
    if (error) throw new Error(error.message);
    const list = (tasks ?? []) as any[];
    if (list.length === 0) return { rows: 0, byStatus: {} };

    const orderIds = list.map((t) => Number(t.order_id));
    const dayFrom = `${date}T00:00:00.000Z`;
    const dayTo = `${date}T23:59:59.999Z`;

    // Звонки по заказам за этот день — через общую связь call_order_link:
    // привязка из RetailCRM основная, наш матчинг по телефону запасной, и
    // время в ней это время разговора, а не сопоставления.
    const callsByOrder = new Map<number, any[]>();
    const callSourceByOrder = new Map<number, string>();
    for (let i = 0; i < orderIds.length; i += 300) {
        const { data: links } = await supabase
            .from('call_order_link')
            .select('order_id, telphin_call_id, started_at, duration_sec, direction, source')
            .in('order_id', orderIds.slice(i, i + 300))
            .gte('started_at', dayFrom)
            .lte('started_at', dayTo);
        for (const l of ((links ?? []) as any[])) {
            const id = Number(l.order_id);
            const arr = callsByOrder.get(id) ?? [];
            arr.push({
                started_at: String(l.started_at),
                duration_sec: Number(l.duration_sec ?? 0),
                direction: l.direction === 'incoming' ? 'incoming' : 'outgoing',
                from_number: '',
                to_number: '',
            });
            callsByOrder.set(id, arr);
            // Источник запоминаем первый: в связи по одному заказу он один и
            // тот же — представление не смешивает CRM и матчинг.
            if (!callSourceByOrder.has(id)) callSourceByOrder.set(id, String(l.source));
        }
    }

    // Письма: наши исходящие по заказу и входящие от клиента.
    const { data: sent } = await supabase
        .from('order_email_sends')
        .select('order_id, created_at')
        .in('order_id', orderIds)
        .gte('created_at', dayFrom)
        .lte('created_at', dayTo);
    const emailsByOrder = new Map<number, number>();
    for (const e of ((sent ?? []) as any[])) {
        emailsByOrder.set(Number(e.order_id), (emailsByOrder.get(Number(e.order_id)) ?? 0) + 1);
    }

    const { data: incoming } = await supabase
        .from('incoming_emails')
        .select('linked_order_id, received_at')
        .in('linked_order_id', orderIds)
        .gte('received_at', dayFrom)
        .lte('received_at', dayTo);
    const replyByOrder = new Map<number, string>();
    for (const e of ((incoming ?? []) as any[])) {
        if (!e.linked_order_id) continue;
        replyByOrder.set(Number(e.linked_order_id), String(e.received_at));
    }

    // Движение заказа и деньги — из истории статусов за этот день.
    const { data: history } = await supabase
        .from('order_history_log')
        .select('retailcrm_order_id, field, old_value, new_value, occurred_at')
        .in('retailcrm_order_id', orderIds)
        .eq('field', 'status')
        .gte('occurred_at', dayFrom)
        .lte('occurred_at', dayTo);

    const { data: dict } = await supabase
        .from('retailcrm_dictionaries')
        .select('item_code, item_name')
        .eq('entity_type', 'status');
    const cancelCodes = new Set(
        ((dict ?? []) as any[])
            .filter((d) => /отмен|купили в другом/i.test(String(d.item_name ?? '')))
            .map((d) => String(d.item_code)),
    );

    const movementByOrder = new Map<number, { type: string; at: string; code: string }>();
    for (const h of ((history ?? []) as any[])) {
        const code = typeof h.new_value === 'object' ? h.new_value?.code : String(h.new_value ?? '').replace(/"/g, '');
        const id = Number(h.retailcrm_order_id);
        const type = PRODUCTION_STATUSES.includes(String(code))
            ? 'sent_to_production'
            : cancelCodes.has(String(code))
              ? 'lost'
              : 'status_changed';
        // Самое «высокое» движение за день: уход в производство важнее любой
        // промежуточной перестановки статуса.
        const prev = movementByOrder.get(id);
        const rank = (t: string) => (t === 'sent_to_production' ? 2 : t === 'status_changed' ? 1 : 0);
        if (!prev || rank(type) > rank(prev.type)) {
            movementByOrder.set(id, { type, at: String(h.occurred_at), code: String(code) });
        }
    }

    const rows: TaskResultRow[] = list.map((t) => {
        const orderId = Number(t.order_id);
        const calls = callsByOrder.get(orderId) ?? [];
        const callSource = callSourceByOrder.get(orderId) ?? null;
        const collapsed = collapseCalls(calls as any[]);
        const movement = movementByOrder.get(orderId);
        const replyAt = replyByOrder.get(orderId) ?? null;

        // Входящий звонок — тоже ответ клиента: «нам перезвонили» доказывает
        // разговор надёжнее, чем наша попытка дозвониться.
        const incomingCall = (calls as any[]).find((c) => c.direction === 'incoming' && Number(c.duration_sec ?? 0) > 20);

        const base = {
            plan_date: date,
            order_id: orderId,
            manager_id: t.manager_id === null ? null : Number(t.manager_id),
            reason_code: t.reason_code ?? null,
            amount: Number(t.amount ?? 0),
            touched: Boolean(t.touched),
            touch_kind: t.touch_kind ?? null,
            calls_count: collapsed.length,
            call_seconds: collapsed.reduce((s, c) => s + c.duration_sec, 0),
            call_first_at: collapsed[0]?.started_at ?? null,
            emails_count: emailsByOrder.get(orderId) ?? 0,
            call_source: callSource,
            client_replied: Boolean(replyAt || incomingCall),
            client_reply_at: replyAt ?? incomingCall?.started_at ?? null,
            movement_type: movement?.type ?? null,
            movement_at: movement?.at ?? null,
            money_type: movement?.type === 'sent_to_production' ? 'sent_to_production' : null,
            money_amount: movement?.type === 'sent_to_production' ? Number(t.amount ?? 0) : null,
            money_at: movement?.type === 'sent_to_production' ? movement.at : null,
            details: {
                calls_raw: (calls as any[]).length,
                calls_collapsed: collapsed.length,
                status_code: movement?.code ?? null,
            },
        };
        const { level, status } = levelOf(base);
        return { ...base, result_level: level, result_status: status };
    });

    const { error: writeError } = await supabase
        .from('sales_rop_task_result')
        .upsert(rows, { onConflict: 'plan_date,order_id' });
    if (writeError) throw new Error(writeError.message);

    const byStatus: Record<string, number> = {};
    for (const r of rows) byStatus[r.result_status] = (byStatus[r.result_status] ?? 0) + 1;
    return { rows: rows.length, byStatus };
}
