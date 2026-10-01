/**
 * План дня менеджера — тот самый, который бот-РОП присылает утром в Telegram.
 *
 * В интерфейсе он нужен тем же составом: те же заказы, та же причина попадания
 * в план и та же отметка «отработано». Второго источника правды заводить
 * нельзя — иначе письмо в чате и экран начнут расходиться.
 */
import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { supabase } from '@/utils/supabase';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
    const session = await getSession();
    if (!session?.user) {
        return NextResponse.json({ error: 'Неавторизован' }, { status: 401 });
    }

    const url = new URL(request.url);
    const date = url.searchParams.get('date') || new Date().toISOString().slice(0, 10);

    // План всегда свой: это задачи того, кто сейчас в системе, а не сводка по
    // отделу. Подменить менеджера параметром нельзя (требование владельца
    // 01.10.2026) — отдел целиком руководитель смотрит в своих разделах.
    const managerId = Number(session.user.retail_crm_manager_id ?? 0);

    if (!managerId) {
        return NextResponse.json({
            date,
            tasks: [],
            note: 'К вашей учётной записи не привязан менеджер — плана нет.',
        });
    }

    const { data, error } = await supabase
        .from('sales_rop_task')
        .select('order_id, order_number, client, amount, reason_text, status_name, touched, touch_kind, weight')
        .eq('plan_date', date)
        .eq('manager_id', managerId)
        .order('weight', { ascending: false });

    if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const tasks = ((data ?? []) as any[]).map((row) => ({
        orderId: Number(row.order_id),
        orderNumber: String(row.order_number ?? ''),
        client: row.client || 'Покупатель не указан',
        amount: Number(row.amount ?? 0),
        reason: row.reason_text || '',
        statusName: row.status_name || '',
        done: row.touched === true,
        doneBy: row.touch_kind || null,
    }));

    return NextResponse.json({
        date,
        managerId,
        tasks,
        total: tasks.length,
        done: tasks.filter((t) => t.done).length,
        amount: tasks.reduce((sum, t) => sum + t.amount, 0),
        // Правило — то же, что у бота: иначе цифры на экране и в чате разойдутся.
        rule: 'Задача считается отработанной, если по заказу сегодня был комментарий, смена статуса, письмо или звонок.',
    });
}
