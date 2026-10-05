/**
 * Карточка клиента: реквизиты, связанные карточки того же юрлица и его заказы.
 * Реквизиты собираются слоем own-crm — в RetailCRM они лежат на заказе.
 */
import { NextResponse } from 'next/server';
import { supabase } from '@/utils/supabase';
import { clientRequisites, relatedClients } from '@/lib/own-crm/clients';
import { clientCalls, clientEmails, clientPhone, clientContacts } from '@/lib/own-crm/client-activity';

export const dynamic = 'force-dynamic';

export async function GET(_request: Request, { params }: { params: { id: string } }) {
    const id = String(params.id);

    const { data: client, error } = await supabase
        .from('clients')
        .select('*')
        .eq('id', id)
        .maybeSingle();

    if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
    if (!client) {
        /**
         * Объясняем словами, что делать: чаще всего это не сбой программы, а
         * незаполненные данные — заказ заведён на живого человека, а компании
         * у него нет (решение владельца 05.10.2026, жалоба Евгении).
         */
        const { data: person } = await supabase
            .from('customers')
            .select('"firstName", "lastName", email')
            .eq('id', id)
            .maybeSingle();

        const who = person
            ? [(person as any).lastName, (person as any).firstName].filter(Boolean).join(' ')
                || (person as any).email
                || 'Этот человек'
            : null;

        return NextResponse.json(
            {
                error: who
                    ? `Карточки компании нет. ${who} заведён у нас как контактное лицо, но ни к одной компании не привязан. Это не ошибка программы, а незаполненные данные: заведите компанию в разделе «Клиенты» и добавьте его в её контактные лица — после этого кнопка откроет карточку.`
                    : 'Контактное лицо не найдено — введите его в карточке компании. Это не ошибка программы, а незаполненные данные: откройте раздел «Клиенты», найдите компанию заказчика и добавьте человека в её контактные лица.',
            },
            { status: 404 },
        );
    }

    const [requisites, related, ordersRes] = await Promise.all([
        clientRequisites(id),
        relatedClients(id),
        supabase
            .from('orders')
            .select('order_id, number, status, totalsumm, "createdAt", manager_id')
            .filter('customer->>id', 'eq', id)
            .order('createdAt', { ascending: false })
            .limit(50),
    ]);

    const orders = (ordersRes.data || []) as any[];

    // Что известно о компании: данные ЕГРЮЛ и стадия отношений собираются в
    // продажах и ключуются по ИНН. Читаем, ничего там не меняя.
    let relation: any = null;
    if (requisites.inn) {
        const { data } = await supabase
            .from('sales_client_relation')
            .select('stage, okved_code, activity, region, company_status, branches, employees, revenue, potential, next_contact_at, last_touch_at, enriched_at')
            .eq('inn', requisites.inn)
            .maybeSingle();
        relation = data || null;
    }

    const [statusesRes, managersRes] = await Promise.all([
        supabase.from('retailcrm_dictionaries').select('item_code, item_name').eq('entity_type', 'status'),
        supabase.from('managers').select('id, first_name, last_name'),
    ]);

    const statusNames = new Map((statusesRes.data || []).map((s: any) => [s.item_code, s.item_name]));
    const managerNames = new Map(
        (managersRes.data || []).map((m: any) => [Number(m.id), [m.last_name, m.first_name].filter(Boolean).join(' ')])
    );

    // Звонки, письма и телефон — отдельным шагом: они не мешают открыть
    // карточку, если какой-то источник подведёт.
    const [calls, emails, phone, contacts] = await Promise.all([
        clientCalls(id).catch(() => []),
        clientEmails([(client as any).email, (client as any).contact_email]).catch(() => []),
        clientPhone(id).catch(() => null),
        clientContacts(id).catch(() => []),
    ]);

    return NextResponse.json({
        client,
        requisites,
        relation,
        related,
        calls,
        emails,
        phone,
        contacts,
        orders: orders.map((o) => ({
            orderId: o.order_id,
            number: o.number,
            statusName: statusNames.get(o.status) || o.status,
            total: o.totalsumm,
            createdAt: o.createdAt,
            managerName: managerNames.get(Number(o.manager_id)) || null,
        })),
    });
}
