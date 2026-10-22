/**
 * Карточка клиента: реквизиты, связанные карточки того же юрлица и его заказы.
 * Реквизиты собираются слоем own-crm — в RetailCRM они лежат на заказе.
 */
import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { hasAnyRole } from '@/lib/rbac';
import { supabase } from '@/utils/supabase';
import { relatedClients } from '@/lib/own-crm/clients';
import { loadClientRequisites } from '@/lib/own-crm/client-requisites';
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

    /**
     * Слитая карточка: ведём на главную. Открывать её незачем — заказы,
     * контакты и реквизиты переехали, а здесь человек увидел бы остатки и
     * решил, что данные пропали.
     */
    if ((client as any).merged_into) {
        return NextResponse.json({ mergedInto: String((client as any).merged_into) }, { status: 200 });
    }

    const [requisites, related, ordersRes] = await Promise.all([
        loadClientRequisites(id),
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
        // ЗАКОН: работаем только с активными — уволенного в выбор не предлагаем.
        supabase.from('managers').select('id, first_name, last_name, active'),
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

    /**
     * Кто ведёт клиента. Раньше в карточке этого не было видно и поменять было
     * нельзя: задачи «напомнить о себе» уходили прежнему владельцу, хотя
     * заказы давно ведёт другой (доработки №32 и №37, 22.10.2026).
     */
    const managerId = (client as any).manager_id === null || (client as any).manager_id === undefined
        ? null
        : Number((client as any).manager_id);

    const managerOptions = ((managersRes.data || []) as any[])
        .filter((m) => m.active !== false)
        .map((m) => ({ id: Number(m.id), name: [m.last_name, m.first_name].filter(Boolean).join(' ') || `Менеджер ${m.id}` }))
        .sort((a, b) => a.name.localeCompare(b.name, 'ru'));

    return NextResponse.json({
        client,
        manager: {
            id: managerId,
            name: managerId !== null ? (managerNames.get(managerId) || null) : null,
            options: managerOptions,
            canChange: true,
        },
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


/**
 * Сменить менеджера, за которым закреплён клиент.
 *
 * Зачем: клиент может годами числиться за тем, кто вёл первый заказ, а
 * работает с ним давно другой. От владельца карточки зависят задачи «напомнить
 * о себе» в плане дня, поэтому неверный владелец — это чужая работа в чужом
 * плане (доработки №32 и №37, 22.10.2026).
 *
 * Премии это не двигает: зарплата считается по менеджеру НА МОМЕНТ продажи
 * (закон проекта), а не по текущему владельцу карточки.
 */
export async function PATCH(request: Request, { params }: { params: { id: string } }) {
    const session = await getSession();
    if (!session?.user) return NextResponse.json({ error: 'Неавторизован' }, { status: 401 });
    if (!hasAnyRole(session, ['admin', 'okk', 'rop', 'manager'])) {
        return NextResponse.json({ error: 'Менять менеджера клиента может отдел продаж' }, { status: 403 });
    }

    const id = String(params.id);
    const body = await request.json().catch(() => ({}));
    const raw = (body as any)?.managerId;
    const managerId = raw === null || raw === '' ? null : Number(raw);

    if (managerId !== null && !Number.isFinite(managerId)) {
        return NextResponse.json({ error: 'Не указан менеджер' }, { status: 400 });
    }

    if (managerId !== null) {
        const { data: manager } = await supabase
            .from('managers')
            .select('id, active, first_name, last_name')
            .eq('id', managerId)
            .maybeSingle();

        if (!manager) return NextResponse.json({ error: 'Такого менеджера нет' }, { status: 400 });
        // ЗАКОН: неактивных не назначаем — клиент не должен уйти уволенному.
        if ((manager as any).active === false) {
            return NextResponse.json({ error: 'Этот менеджер больше не работает — выберите действующего' }, { status: 400 });
        }
    }

    const { error } = await supabase
        .from('clients')
        .update({ manager_id: managerId, updated_at: new Date().toISOString() })
        .eq('id', id);

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    return NextResponse.json({ ok: true, managerId });
}
