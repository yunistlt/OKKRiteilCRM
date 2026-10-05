/**
 * Новые задачи по заказам — для всплывающего оповещения.
 *
 * Ирина Гордеева 05.10.2026: «задача поставленная выскакивает как письмо.
 * Можно, чтобы была указана сама задача?» Оповещения были только о письмах, и
 * задачу по тому же заказу человек принимал за письмо. Теперь у задачи своё
 * оповещение — с её текстом и сроком.
 */
import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { supabase } from '@/utils/supabase';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: 'Неавторизован' }, { status: 401 });

    const { searchParams } = new URL(req.url);
    const since = searchParams.get('since');
    // Первый заход: последний час, чтобы не вываливать всё за ночь.
    const from = since && !Number.isNaN(Date.parse(since))
        ? new Date(since)
        : new Date(Date.now() - 60 * 60 * 1000);

    const { data: tasks, error } = await supabase
        .from('order_tasks')
        .select('id, order_number, title, due_date, due_time, created_by, created_at')
        .eq('done', false)
        .gt('created_at', from.toISOString())
        .order('created_at', { ascending: false })
        .limit(20);

    if (error) {
        console.error('[task-alerts] задачи не прочитались:', error);
        return NextResponse.json({ error: 'Не удалось прочитать задачи' }, { status: 500 });
    }

    const rows = (tasks || []) as any[];
    if (!rows.length) return NextResponse.json({ tasks: [], checkedAt: new Date().toISOString() });

    // Менеджеру — задачи по его заказам, руководителю и ОКК — по всем.
    const managerId = session.user.retail_crm_manager_id;
    const onlyMine = session.user.role === 'manager' && managerId;

    let allowed = new Set(rows.map((row) => String(row.order_number)));
    if (onlyMine) {
        const { data: orders } = await supabase
            .from('orders')
            .select('number')
            .in('number', Array.from(allowed))
            .eq('manager_id', managerId);
        allowed = new Set(((orders || []) as any[]).map((row) => String(row.number)));
    }

    return NextResponse.json({
        tasks: rows
            .filter((row) => allowed.has(String(row.order_number)))
            .map((row) => ({
                id: `task-${row.id}`,
                orderNumber: String(row.order_number),
                title: String(row.title ?? ''),
                due: row.due_date
                    ? `${new Date(row.due_date).toLocaleDateString('ru-RU')}${row.due_time ? ` в ${String(row.due_time).slice(0, 5)}` : ''}`
                    : null,
                author: row.created_by ?? null,
                createdAt: row.created_at,
            })),
        checkedAt: new Date().toISOString(),
    });
}
