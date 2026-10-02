/**
 * Реквизиты заказчика в заказе.
 *
 * Хозяин реквизитов — клиент (решение владельца 02.10.2026), поэтому здесь мы
 * только показываем его реквизиты и по кнопке подставляем их в заказ: счёт и
 * КП печатаются из заказа, и в момент печати реквизиты должны быть в нём.
 */
import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { supabase } from '@/utils/supabase';
import { fromOrderContragent, loadClientRequisites, toOrderContragent } from '@/lib/own-crm/client-requisites';
import { editOrder } from '@/lib/own-crm/edit-order';

export const dynamic = 'force-dynamic';

async function findOrder(id: string) {
    const { data } = await supabase
        .from('orders')
        .select('id, order_id, number, raw_payload')
        .eq('order_id', id)
        .maybeSingle();
    return (data as any) ?? null;
}

function clientIdOf(order: any): string | null {
    const id = order?.raw_payload?.customer?.id;
    return id ? String(id) : null;
}

export async function GET(_request: Request, { params }: { params: { id: string } }) {
    const session = await getSession();
    if (!session?.user) return NextResponse.json({ error: 'Неавторизован' }, { status: 401 });

    const order = await findOrder(params.id);
    if (!order) return NextResponse.json({ error: 'Заказ не найден' }, { status: 404 });

    const clientId = clientIdOf(order);

    return NextResponse.json({
        ok: true,
        clientId,
        /** Что сейчас лежит в самом заказе — его и печатают счёт с КП. */
        inOrder: fromOrderContragent(order.raw_payload?.contragent),
        /** Реквизиты клиента: ими и надо пользоваться. */
        client: clientId ? await loadClientRequisites(clientId) : null,
    });
}

/** Подставить реквизиты клиента в заказ. */
export async function POST(_request: Request, { params }: { params: { id: string } }) {
    const session = await getSession();
    if (!session?.user) return NextResponse.json({ error: 'Неавторизован' }, { status: 401 });

    const order = await findOrder(params.id);
    if (!order) return NextResponse.json({ error: 'Заказ не найден' }, { status: 404 });

    const clientId = clientIdOf(order);
    if (!clientId) {
        return NextResponse.json(
            { error: 'У заказа не указан покупатель — реквизиты брать неоткуда' },
            { status: 409 },
        );
    }

    const client = await loadClientRequisites(clientId);
    const contragent = toOrderContragent(client);

    if (!Object.keys(contragent).length) {
        return NextResponse.json(
            { error: 'В карточке клиента реквизитов нет — внесите их там' },
            { status: 409 },
        );
    }

    const result = await editOrder(Number(order.id), { contragent } as any);
    if (!result.ok) return NextResponse.json({ error: result.reason }, { status: 409 });

    return NextResponse.json({ ok: true, contragent });
}
