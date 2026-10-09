/**
 * Новые задачи по заказам — для всплывающего оповещения.
 *
 * Ирина Гордеева 05.10.2026: «задача поставленная выскакивает как письмо.
 * Можно, чтобы была указана сама задача?» Оповещения были только о письмах, и
 * задачу по тому же заказу человек принимал за письмо. Теперь у задачи своё
 * оповещение — с её текстом и сроком.
 *
 * Она же в тот же день: «это оповещение нужно завтра. я поставила, а оно сразу
 * пришло». Оповещение шло по дате создания задачи, поэтому выскакивало в момент
 * постановки. Теперь оно приходит в срок, записанный в самой задаче
 * (`due_date` + `due_time`), а по дате создания — только у задач без срока.
 */
import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { alertAudience } from '@/lib/alerts/audience';
import { supabase } from '@/utils/supabase';
import { clientsByOrderNumbers } from '@/lib/orders/order-client';
import { keepUnseen } from '@/lib/alerts/seen';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: 'Неавторизован' }, { status: 401 });

    /**
     * Окно свежести часовое. Что уже показывали — помнит система
     * (`alert_seen`), «since» от браузера здесь ничего не решает.
     */
    const from = new Date(Date.now() - 60 * 60 * 1000);

    const now = new Date();
    // Срок задаётся по-московски, как его видит человек в карточке.
    const today = new Date(now.getTime() + 3 * 60 * 60 * 1000).toISOString().slice(0, 10);

    /**
     * Берём задачи, срок которых мог наступить, плюс бессрочные, поставленные
     * только что. Точный момент считаем ниже: сложить дату со временем
     * запросом нельзя — это разные колонки.
     */
    const { data: tasks, error } = await supabase
        .from('order_tasks')
        .select('id, order_number, title, due_date, due_time, created_by, created_at')
        .eq('done', false)
        .or(`due_date.lte.${today},due_date.is.null`)
        .order('created_at', { ascending: false })
        .limit(200);

    if (error) {
        console.error('[task-alerts] задачи не прочитались:', error);
        return NextResponse.json({ error: 'Не удалось прочитать задачи' }, { status: 500 });
    }

    /**
     * Момент, когда задача должна о себе напомнить: её срок, а у задачи без
     * срока — время постановки. Время московское: именно его человек вводит.
     */
    const remindAt = (row: any): number => {
        if (!row.due_date) return Date.parse(row.created_at);
        const time = row.due_time ? String(row.due_time).slice(0, 8) : '00:00:00';
        return Date.parse(`${String(row.due_date).slice(0, 10)}T${time}+03:00`);
    };

    // Оповещаем один раз — в тот заход, когда срок перешагнул текущее время.
    const rows = ((tasks || []) as any[]).filter((row) => {
        const at = remindAt(row);
        return Number.isFinite(at) && at > from.getTime() && at <= now.getTime();
    });
    if (!rows.length) return NextResponse.json({ tasks: [], checkedAt: new Date().toISOString() });

    // Оповещение — тому, кто ведёт заказ (см. lib/alerts/audience.ts).
    const audience = alertAudience(session);
    if (!audience) return NextResponse.json({ tasks: [], checkedAt: new Date().toISOString() });

    const { data: orders } = await supabase
        .from('orders')
        .select('number')
        .in('number', Array.from(new Set(rows.map((row) => String(row.order_number)))))
        .eq('manager_id', audience.managerId);
    const allowed = new Set(((orders || []) as any[]).map((row) => String(row.number)));

    // Чей это заказ: в оповещении имя клиента ведёт в его карточку.
    const clients = await clientsByOrderNumbers(Array.from(allowed));

    const freshTasks = rows
            .filter((row) => allowed.has(String(row.order_number)))
            .map((row) => ({
                id: `task-${row.id}`,
                orderNumber: String(row.order_number),
                clientId: clients.get(String(row.order_number))?.clientId ?? null,
                clientName: clients.get(String(row.order_number))?.clientName ?? null,
                title: String(row.title ?? ''),
                due: row.due_date
                    ? `${new Date(row.due_date).toLocaleDateString('ru-RU')}${row.due_time ? ` в ${String(row.due_time).slice(0, 5)}` : ''}`
                    : null,
                author: row.created_by ?? null,
                createdAt: row.created_at,
            }));

    const viewer = session.user.email || session.user.username || session.user.id;

    return NextResponse.json({
        tasks: await keepUnseen(viewer, freshTasks),
        checkedAt: new Date().toISOString(),
    });
}
