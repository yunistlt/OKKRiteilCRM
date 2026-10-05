/**
 * Центр оповещений менеджера: письма, задачи и звонки по его заказам одной
 * лентой, с отметкой «прочитано».
 *
 * Решение владельца 05.10.2026: «нужно сделать так же, как в RetailCRM — тут
 * все оповещения менеджера, каждый видит свои, очень удобно». Всплывающие окна
 * показывают только то, что случилось сейчас; сюда человек заходит посмотреть,
 * что он мог пропустить.
 *
 * Своей таблицы у оповещений нет: события уже лежат в письмах, задачах и
 * звонках — собираем их на лету. Храним только отметки прочтения.
 */
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getSession } from '@/lib/auth';
import { supabase } from '@/utils/supabase';
import { phoneTail } from '@/lib/orders-filter';

export const dynamic = 'force-dynamic';

/** За сколько дней показываем ленту. Глубже человек уходит в сами разделы. */
const DAYS = 7;

export type NotificationItem = {
    id: string;
    kind: 'mail' | 'task' | 'call';
    at: string;
    /** Главная строка: о чём оповещение. */
    text: string;
    /** Кто или что рядом: отправитель, срок, номер. */
    note: string | null;
    orderNumber: string | null;
    read: boolean;
};

export async function GET() {
    const session = await getSession();
    if (!session?.user) return NextResponse.json({ error: 'Неавторизован' }, { status: 401 });

    const since = new Date(Date.now() - DAYS * 24 * 60 * 60 * 1000).toISOString();
    const managerId = session.user.retail_crm_manager_id;
    // Менеджер видит своё, остальные роли — всё: им нужна картина по отделу.
    const onlyMine = session.user.role === 'manager' && managerId;

    const [mails, tasks, calls, reads] = await Promise.all([
        supabase
            .from('incoming_emails')
            .select('id, subject, from_name, from_email, received_at, created_crm_order_number')
            .not('created_crm_order_number', 'is', null)
            .gt('received_at', since)
            .order('received_at', { ascending: false })
            .limit(100),
        supabase
            .from('order_tasks')
            .select('id, order_number, title, due_date, due_time, created_by, created_at')
            .gt('created_at', since)
            .order('created_at', { ascending: false })
            .limit(100),
        supabase
            .from('raw_telphin_calls')
            .select('telphin_call_id, from_number, from_number_normalized, started_at')
            .eq('direction', 'incoming')
            .gt('started_at', since)
            .order('started_at', { ascending: false })
            .limit(100),
        supabase
            .from('notification_reads')
            .select('item_id')
            .eq('user_id', String(session.user.id)),
    ]);

    const readIds = new Set(((reads.data ?? []) as any[]).map((r) => String(r.item_id)));

    // Чьи это заказы: по номерам из писем и задач, по телефону — из звонков.
    const numbers = Array.from(new Set([
        ...((mails.data ?? []) as any[]).map((m) => String(m.created_crm_order_number)),
        ...((tasks.data ?? []) as any[]).map((t) => String(t.order_number)),
    ].filter(Boolean)));

    const orderManager = new Map<string, number | null>();
    if (numbers.length) {
        const { data } = await supabase.from('orders').select('number, manager_id').in('number', numbers);
        for (const row of ((data ?? []) as any[])) orderManager.set(String(row.number), row.manager_id ?? null);
    }

    const mine = (number: string | null) =>
        !onlyMine || (number !== null && Number(orderManager.get(number)) === Number(managerId));

    const items: NotificationItem[] = [];

    for (const mail of ((mails.data ?? []) as any[])) {
        const number = String(mail.created_crm_order_number);
        if (!mine(number)) continue;
        items.push({
            id: `in-${mail.id}`,
            kind: 'mail',
            at: mail.received_at,
            text: mail.subject || 'Письмо без темы',
            note: mail.from_name || mail.from_email || null,
            orderNumber: number,
            read: readIds.has(`in-${mail.id}`),
        });
    }

    for (const task of ((tasks.data ?? []) as any[])) {
        const number = task.order_number ? String(task.order_number) : null;
        if (!mine(number)) continue;
        items.push({
            id: `task-${task.id}`,
            kind: 'task',
            at: task.created_at,
            text: task.title || 'Задача',
            note: [
                task.due_date
                    ? `срок ${new Date(task.due_date).toLocaleDateString('ru-RU')}${task.due_time ? ` в ${String(task.due_time).slice(0, 5)}` : ''}`
                    : null,
                task.created_by ? `поставил ${task.created_by}` : null,
            ].filter(Boolean).join(' · ') || null,
            orderNumber: number,
            read: readIds.has(`task-${task.id}`),
        });
    }

    // Звонки: чей номер — ищем только для своих, чтобы не дёргать базу зря.
    for (const call of ((calls.data ?? []) as any[])) {
        const tail = phoneTail(call.from_number_normalized || call.from_number || '');
        let number: string | null = null;
        let manager: number | null = null;

        if (tail) {
            const { data } = await supabase
                .from('orders')
                .select('number, manager_id')
                .ilike('phone', `%${tail}%`)
                .is('crm_deleted_at', null)
                .order('createdAt', { ascending: false })
                .limit(1);
            const row = ((data ?? []) as any[])[0];
            number = row ? String(row.number) : null;
            manager = row?.manager_id ?? null;
        }

        if (onlyMine && Number(manager) !== Number(managerId)) continue;

        items.push({
            id: `call-${call.telphin_call_id}`,
            kind: 'call',
            at: call.started_at,
            text: `Входящий звонок ${call.from_number}`,
            note: null,
            orderNumber: number,
            read: readIds.has(`call-${call.telphin_call_id}`),
        });
    }

    items.sort((a, b) => String(b.at).localeCompare(String(a.at)));

    return NextResponse.json({
        items: items.slice(0, 100),
        unread: items.filter((item) => !item.read).length,
    });
}

const bodySchema = z.object({
    /** Что пометить прочитанным; пусто — пометить всё. */
    ids: z.array(z.string().max(200)).max(200).optional(),
});

export async function POST(request: Request) {
    const session = await getSession();
    if (!session?.user) return NextResponse.json({ error: 'Неавторизован' }, { status: 401 });

    const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
    const ids = parsed.success ? parsed.data.ids ?? [] : [];
    if (!ids.length) return NextResponse.json({ ok: true, marked: 0 });

    const userId = String(session.user.id);
    const { error } = await supabase
        .from('notification_reads')
        .upsert(ids.map((item_id) => ({ user_id: userId, item_id })), { onConflict: 'user_id,item_id' });

    if (error) {
        console.error('[оповещения] не отметились прочитанными:', error.message);
        return NextResponse.json({ error: 'Не удалось отметить прочитанными' }, { status: 500 });
    }

    return NextResponse.json({ ok: true, marked: ids.length });
}
