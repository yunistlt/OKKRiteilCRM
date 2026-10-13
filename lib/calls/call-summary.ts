/**
 * Короткая сводка по сделке — для того, кто прямо сейчас разговаривает.
 *
 * Просьба владельца 05.10.2026: если менеджер говорит и заказ определён,
 * показывать краткое саммари. Человеку в разговоре некогда читать карточку:
 * нужно за секунду вспомнить, о чём сделка, на чём остановились и что обещали.
 *
 * Поэтому здесь только то, что меняет ход разговора: предмет и сумма, где
 * заказ стоит и сколько, что было последним, невыполненные задачи и когда
 * обещали связаться. Никаких вычислений и выдумок — всё из заказа.
 */
import { supabase } from '@/utils/supabase';
import { formatEventValue } from '@/lib/order-events';
import { buildFieldLabelResolver } from '@/lib/order-field-labels';

export type CallSummary = {
    orderNumber: string;
    /** Статус человеческим языком, а не кодом. */
    status: string | null;
    /** Сколько дней заказ в этом статусе — видно, что он залежался. */
    daysInStatus: number | null;
    sum: number | null;
    /** Что заказывают: первые позиции состава. */
    items: string[];
    itemsMore: number;
    client: string | null;
    manager: string | null;
    createdAt: string | null;
    /** Последнее событие по заказу: что произошло в прошлый раз. */
    lastEvent: string | null;
    lastEventAt: string | null;
    /** Невыполненные задачи — то, что обещали сделать. */
    tasks: Array<{ title: string; due: string | null }>;
    /** Когда договорились связаться. */
    nextContact: string | null;
    /** Последнее отправленное письмо: о чём и когда. */
    lastEmail: string | null;
    lastEmailAt: string | null;
};

const day = (value: any): string | null => {
    if (!value) return null;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date.toLocaleDateString('ru-RU');
};

export async function callSummary(orderId: number): Promise<CallSummary | null> {
    const { data: order } = await supabase
        .from('orders')
        .select('id, number, status, totalsumm, "createdAt", created_at, manager_id, data_kontakta, customer, raw_payload')
        .eq('id', orderId)
        .maybeSingle();

    if (!order) return null;
    const row = order as any;
    const orderNumber = String(row.number ?? orderId);

    const [statusRow, items, history, tasks, mail, manager] = await Promise.all([
        supabase.from('crm_statuses').select('name').eq('external_code', row.status).maybeSingle(),
        supabase.from('order_items').select('"offer", quantity').eq('order_id', orderId).limit(6),
        // Последнее содержательное событие: по нему видно, на чём остановились.
        // Берём с запасом — часть записей служебные и человеку ничего не говорят.
        supabase.from('order_history_log')
            .select('field, new_value, occurred_at')
            .eq('retailcrm_order_id', row.id)
            .order('occurred_at', { ascending: false })
            .limit(10),
        supabase.from('order_tasks')
            .select('title, due_date, due_time')
            .eq('order_number', orderNumber)
            .eq('done', false)
            .order('due_date', { ascending: true })
            .limit(3),
        supabase.from('order_email_sends')
            .select('subject, created_at')
            .eq('order_number', orderNumber)
            .order('created_at', { ascending: false })
            .limit(1),
        row.manager_id
            ? supabase.from('managers').select('first_name, last_name').eq('id', row.manager_id).maybeSingle()
            : Promise.resolve({ data: null } as any),
    ]);

    // Сколько заказ стоит в нынешнем статусе: ищем последнюю смену статуса.
    const { data: statusChange } = await supabase
        .from('order_history_log')
        .select('occurred_at')
        .eq('retailcrm_order_id', row.id)
        .eq('field', 'status')
        .order('occurred_at', { ascending: false })
        .limit(1);

    // Дата заведения: у части заказов заполнена колонка RetailCRM, у части — наша.
    const created = row.createdAt || row.created_at || null;
    const since = ((statusChange ?? []) as any[])[0]?.occurred_at ?? created;
    const daysInStatus = since
        ? Math.max(0, Math.floor((Date.now() - new Date(since).getTime()) / 86400000))
        : null;

    const itemRows = ((items as any).data ?? []) as any[];
    const names = itemRows
        .map((item) => {
            const name = item.offer?.displayName || item.offer?.name || 'Позиция';
            const qty = Number(item.quantity || 0);
            return qty > 1 ? `${name} × ${qty}` : name;
        })
        .slice(0, 3);

    /**
     * Событие человеческим языком: «Статус заказа: В просчёте». Служебные
     * записи вроде `{"id":321}` пропускаем — в разговоре они бесполезны.
     */
    const fieldLabel = await buildFieldLabelResolver();

    // Коды статусов в истории переводим в имена: закон проекта — только
    // человеческий язык, «tender-s-dubliruyuschimi-zayavkami» никому не понятно.
    const [{ data: allStatuses }, { data: crmStatuses }] = await Promise.all([
        supabase.from('crm_statuses').select('external_code, name'),
        // Коды RetailCRM шире нашего справочника: заказы ходят с их кодами
        // («dubliu-zaiavki»), и без этого в сводке был бы латинский код.
        supabase.from('retailcrm_dictionaries').select('item_code, item_name').eq('entity_type', 'status'),
    ]);
    const statusNames = new Map<string, string>();
    for (const st of ((crmStatuses ?? []) as any[])) statusNames.set(String(st.item_code), String(st.item_name));
    for (const st of ((allStatuses ?? []) as any[])) statusNames.set(String(st.external_code), String(st.name));

    const lastHistory = (((history as any).data ?? []) as any[])
        .map((event) => {
            const field = String(event.field ?? '');
            const value = formatEventValue(event.new_value).trim();
            const text = field === 'status' ? (statusNames.get(value) ?? value) : value;
            return { ...event, text, label: fieldLabel(field) };
        })
        .find((event) => event.text && !/^\{.*\}$/.test(event.text) && !/^\d+$/.test(event.text));
    const managerRow = (manager as any).data;
    const lastMail = (((mail as any).data ?? []) as any[])[0];
    const payload = row.raw_payload ?? {};

    return {
        orderNumber,
        status: ((statusRow as any).data?.name as string) ?? statusNames.get(String(row.status)) ?? row.status ?? null,
        daysInStatus,
        sum: row.totalsumm === null || row.totalsumm === undefined ? null : Number(row.totalsumm),
        items: names,
        itemsMore: Math.max(0, itemRows.length - names.length),
        client: payload.customer?.nickName
            || payload.contragent?.legalName
            || [payload.firstName, payload.lastName].filter(Boolean).join(' ')
            || null,
        manager: managerRow ? [managerRow.last_name, managerRow.first_name].filter(Boolean).join(' ') : null,
        createdAt: day(created),
        lastEvent: lastHistory ? `${lastHistory.label}: ${lastHistory.text}`.slice(0, 120) : null,
        lastEventAt: day(lastHistory?.occurred_at),
        tasks: (((tasks as any).data ?? []) as any[]).map((task) => ({
            title: String(task.title ?? ''),
            due: task.due_date
                ? `${day(task.due_date)}${task.due_time ? ` в ${String(task.due_time).slice(0, 5)}` : ''}`
                : null,
        })),
        nextContact: day(row.data_kontakta),
        lastEmail: lastMail?.subject ? String(lastMail.subject).slice(0, 80) : null,
        lastEmailAt: day(lastMail?.created_at),
    };
}
