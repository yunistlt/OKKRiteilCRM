/**
 * Реквизиты заказчика в заказе.
 *
 * Хозяин реквизитов — клиент (решение владельца 02.10.2026): правятся они в
 * его карточке и в заказ подтягиваются сами. Кнопки «подставить» нет — человек
 * не должен помнить про перенос (замечание владельца 02.10.2026). Переносим
 * молча при открытии карточки: счёт и КП печатаются из заказа, значит в нём
 * реквизиты должны лежать свежими.
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
    const client = clientId ? await loadClientRequisites(clientId) : null;

    // Реквизиты клиента свежее тех, что лежат в заказе, — переносим.
    if (client?.source === 'client') {
        const contragent = toOrderContragent(client);
        const current = order.raw_payload?.contragent ?? {};
        const stale = Object.entries(contragent).some(([key, value]) => String((current as any)[key] ?? '') !== String(value ?? ''));

        if (stale && Object.keys(contragent).length) {
            const result = await editOrder(Number(order.id), { contragent } as any);
            if (result.ok) order.raw_payload = { ...(order.raw_payload ?? {}), contragent: { ...current, ...contragent } };
            else console.warn('[requisites] не перенёс реквизиты в заказ:', result.reason);
        }
    }

    return NextResponse.json({
        ok: true,
        clientId,
        /** Что сейчас лежит в самом заказе — его и печатают счёт с КП. */
        inOrder: fromOrderContragent(order.raw_payload?.contragent),
        /** Реквизиты клиента: ими и надо пользоваться. */
        client,
    });
}
