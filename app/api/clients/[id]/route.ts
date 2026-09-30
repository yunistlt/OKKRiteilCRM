/**
 * Карточка клиента: реквизиты, связанные карточки того же юрлица и его заказы.
 * Реквизиты собираются слоем own-crm — в RetailCRM они лежат на заказе.
 */
import { NextResponse } from 'next/server';
import { supabase } from '@/utils/supabase';
import { clientRequisites, relatedClients } from '@/lib/own-crm/clients';
import { clientCalls, clientEmails, clientPhone } from '@/lib/own-crm/client-activity';

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
        return NextResponse.json({ error: 'Клиент не найден' }, { status: 404 });
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
    const [calls, emails, phone] = await Promise.all([
        clientCalls(id).catch(() => []),
        clientEmails([(client as any).email, (client as any).contact_email]).catch(() => []),
        clientPhone(id).catch(() => null),
    ]);

    return NextResponse.json({
        client,
        requisites,
        relation,
        related,
        calls,
        emails,
        phone,
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
