/**
 * Оплаты по своему заказу.
 *
 * У заказов RetailCRM оплаты живут там, и здесь их нет: этот журнал — только
 * для заказов, заведённых у нас (у них в RetailCRM нет заказа, в котором можно
 * отразить платёж).
 */
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getSession } from '@/lib/auth';
import { addOwnPayment, paymentState, removeOwnPayment } from '@/lib/own-crm/payments';
import { supabase } from '@/utils/supabase';

export const dynamic = 'force-dynamic';

const bodySchema = z.object({
    amount: z.coerce.number().positive(),
    paidAt: z.string().trim().min(8),
    method: z.string().trim().max(100).optional().nullable(),
    payerName: z.string().trim().max(300).optional().nullable(),
    purpose: z.string().trim().max(1000).optional().nullable(),
    note: z.string().trim().max(1000).optional().nullable(),
});

async function ownOrder(orderId: number) {
    const { data } = await supabase
        .from('orders')
        .select('id, number, is_own')
        .eq('id', orderId)
        .maybeSingle();
    return (data as any) ?? null;
}

export async function GET(_request: Request, { params }: { params: { id: string } }) {
    const session = await getSession();
    if (!session?.user) return NextResponse.json({ error: 'Неавторизован' }, { status: 401 });

    const orderId = Number(params.id);
    if (!Number.isFinite(orderId)) return NextResponse.json({ error: 'Неверный номер заказа' }, { status: 400 });

    const order = await ownOrder(orderId);
    if (!order?.is_own) {
        return NextResponse.json({ own: false, payments: [], total: 0, paid: 0, left: 0 });
    }

    const state = await paymentState(orderId);
    return NextResponse.json({ own: true, ...state });
}

export async function POST(request: Request, { params }: { params: { id: string } }) {
    const session = await getSession();
    if (!session?.user) return NextResponse.json({ error: 'Неавторизован' }, { status: 401 });

    const orderId = Number(params.id);
    const order = await ownOrder(orderId);
    if (!order?.is_own) {
        return NextResponse.json(
            { error: 'Это заказ RetailCRM — оплату по нему проводят там, а не здесь' },
            { status: 409 },
        );
    }

    const parsed = bodySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
        return NextResponse.json({ error: 'Платёж заполнен неверно', details: parsed.error.issues }, { status: 400 });
    }

    try {
        await addOwnPayment({
            orderId,
            orderNumber: String(order.number ?? orderId),
            ...parsed.data,
            createdBy: session.user.username || session.user.email || null,
        });
    } catch (e: any) {
        return NextResponse.json({ error: e.message }, { status: 409 });
    }

    return NextResponse.json({ ok: true, ...(await paymentState(orderId)) });
}

export async function DELETE(request: Request, { params }: { params: { id: string } }) {
    const session = await getSession();
    if (!session?.user) return NextResponse.json({ error: 'Неавторизован' }, { status: 401 });

    const orderId = Number(params.id);
    const paymentId = Number(new URL(request.url).searchParams.get('paymentId'));
    if (!Number.isFinite(paymentId)) {
        return NextResponse.json({ error: 'Не указан платёж' }, { status: 400 });
    }

    await removeOwnPayment(paymentId);
    return NextResponse.json({ ok: true, ...(await paymentState(orderId)) });
}
