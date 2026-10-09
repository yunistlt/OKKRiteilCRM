import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { supabase } from '@/utils/supabase';
import { clientsByOrderNumbers } from '@/lib/orders/order-client';
import { keepUnseen } from '@/lib/alerts/seen';

export const dynamic = 'force-dynamic';

/**
 * Новые письма по заказам менеджера — для всплывающего оповещения.
 *
 * Лена Парфёнова 05.10.2026: «можно настроить оповещения по входящим письмам в
 * конкретный заказ? Всплывающее окно было в RetailCRM». Письмо по заказу — это
 * повод ответить сегодня, а раньше его замечали, только зайдя в карточку.
 *
 * Опрос, а не живой поток: почта приходит кроном раз в пять минут, мгновенность
 * тут не нужна, а лишнее постоянное соединение на каждого менеджера — нужна ещё
 * меньше.
 */
export async function GET(req: Request) {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: 'Неавторизован' }, { status: 401 });

    /**
     * Окно свежести — часовое и жёсткое. Что человеку уже показывали, помнит
     * система (`alert_seen`), а не браузер: «since» от клиента здесь больше
     * ничего не решает. Письмо старше часа — не новость, оно и так лежит в
     * заказе (решение владельца 09.10.2026).
     */
    const from = new Date(Date.now() - 60 * 60 * 1000);

    const managerId = session.user.retail_crm_manager_id;
    // Руководителю и ОКК показываем письма по всем заказам, менеджеру — по своим.
    const onlyMine = session.user.role === 'manager' && managerId;

    const { data: letters, error } = await supabase
        .from('incoming_emails')
        .select('id, subject, from_email, from_name, received_at, created_crm_order_number')
        .not('created_crm_order_number', 'is', null)
        .gt('received_at', from.toISOString())
        .order('received_at', { ascending: false })
        .limit(20);

    if (error) {
        console.error('[email-alerts] письма не прочитались:', error);
        return NextResponse.json({ error: 'Не удалось прочитать письма' }, { status: 500 });
    }

    const rows = (letters || []) as any[];
    if (!rows.length) return NextResponse.json({ letters: [], checkedAt: new Date().toISOString() });

    // Оставляем письма по заказам этого менеджера.
    const numbers = Array.from(new Set(rows.map((row) => String(row.created_crm_order_number))));
    let allowed = new Set(numbers);

    if (onlyMine) {
        const { data: orders } = await supabase
            .from('orders')
            .select('number')
            .in('number', numbers)
            .eq('manager_id', managerId);
        allowed = new Set(((orders || []) as any[]).map((row) => String(row.number)));
    }

    // Чей это заказ: в оповещении имя клиента ведёт в его карточку.
    const clients = await clientsByOrderNumbers(Array.from(allowed));

    const fresh = rows
            .filter((row) => allowed.has(String(row.created_crm_order_number)))
            .map((row) => ({
                id: row.id,
                orderNumber: String(row.created_crm_order_number),
                clientId: clients.get(String(row.created_crm_order_number))?.clientId ?? null,
                clientName: clients.get(String(row.created_crm_order_number))?.clientName ?? null,
                subject: row.subject || 'Без темы',
                from: row.from_name || row.from_email || 'Неизвестный отправитель',
                receivedAt: row.received_at,
            }));

    // Отдаём только то, чего человек ещё не видел, и сразу это запоминаем.
    const viewer = session.user.email || session.user.username || session.user.id;

    return NextResponse.json({
        letters: await keepUnseen(viewer, fresh),
        checkedAt: new Date().toISOString(),
    });
}
