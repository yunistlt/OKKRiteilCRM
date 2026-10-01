/**
 * План дня — тот самый, который бот-РОП присылает утром в Telegram.
 *
 * Менеджеру — его собственные задачи: не сводка по отделу, а то, что делать
 * сегодня ему. Руководителю своих задач нет, и пустое окно ему без толку,
 * поэтому он видит план всего отдела, разложенный по людям (требование
 * владельца 01.10.2026).
 *
 * Состав берём из того же `sales_rop_task`, что и письмо бота: второй источник
 * правды разошёлся бы с чатом в первый же день.
 */
import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { supabase } from '@/utils/supabase';

export const dynamic = 'force-dynamic';

/** Роли, которые отвечают за отдел целиком, а не за свои заказы. */
const CHIEF_ROLES = new Set(['admin', 'rop', 'okk']);

type TaskRow = {
    order_id: number;
    order_number: string;
    client: string | null;
    amount: number | null;
    reason_text: string | null;
    status_name: string | null;
    touched: boolean | null;
    touch_kind: string | null;
    manager_id: number;
};

function toTask(row: TaskRow) {
    return {
        orderId: Number(row.order_id),
        orderNumber: String(row.order_number ?? ''),
        client: row.client || 'Покупатель не указан',
        amount: Number(row.amount ?? 0),
        reason: row.reason_text || '',
        statusName: row.status_name || '',
        done: row.touched === true,
        doneBy: row.touch_kind || null,
    };
}

const RULE =
    'Задача считается отработанной, если по заказу сегодня был комментарий, смена статуса, письмо или звонок.';

export async function GET(request: Request) {
    const session = await getSession();
    if (!session?.user) {
        return NextResponse.json({ error: 'Неавторизован' }, { status: 401 });
    }

    const date = new URL(request.url).searchParams.get('date') || new Date().toISOString().slice(0, 10);
    const ownManagerId = Number(session.user.retail_crm_manager_id ?? 0);
    const isChief = CHIEF_ROLES.has(String(session.user.role));

    const columns = 'order_id, order_number, client, amount, reason_text, status_name, touched, touch_kind, manager_id';

    // Менеджер со своим планом видит только его — чужие задачи ему не работа.
    if (ownManagerId && !isChief) {
        const { data, error } = await supabase
            .from('sales_rop_task')
            .select(columns)
            .eq('plan_date', date)
            .eq('manager_id', ownManagerId)
            .order('weight', { ascending: false });

        if (error) return NextResponse.json({ error: error.message }, { status: 500 });

        const tasks = ((data ?? []) as TaskRow[]).map(toTask);
        return NextResponse.json({
            scope: 'own',
            date,
            tasks,
            total: tasks.length,
            done: tasks.filter((t) => t.done).length,
            rule: RULE,
        });
    }

    // Руководитель — весь отдел, по людям: кто сколько должен отработать сегодня.
    const { data, error } = await supabase
        .from('sales_rop_task')
        .select(columns)
        .eq('plan_date', date)
        .order('weight', { ascending: false });

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    const rows = (data ?? []) as TaskRow[];
    const managerIds = Array.from(new Set(rows.map((r) => Number(r.manager_id)).filter(Boolean)));

    const names = new Map<number, string>();
    if (managerIds.length) {
        const { data: managers } = await supabase
            .from('managers')
            .select('id, first_name, last_name')
            .in('id', managerIds);

        for (const m of ((managers ?? []) as any[])) {
            names.set(Number(m.id), [m.last_name, m.first_name].filter(Boolean).join(' ') || `Менеджер ${m.id}`);
        }
    }

    const byManager = new Map<number, ReturnType<typeof toTask>[]>();
    for (const row of rows) {
        const id = Number(row.manager_id);
        if (!byManager.has(id)) byManager.set(id, []);
        byManager.get(id)!.push(toTask(row));
    }

    const managers = Array.from(byManager.entries())
        .map(([managerId, tasks]) => ({
            managerId,
            name: names.get(managerId) || `Менеджер ${managerId}`,
            tasks,
            total: tasks.length,
            done: tasks.filter((t) => t.done).length,
        }))
        .sort((a, b) => b.total - a.total);

    return NextResponse.json({
        scope: 'department',
        date,
        managers,
        total: rows.length,
        done: rows.filter((r) => r.touched === true).length,
        rule: RULE,
    });
}
