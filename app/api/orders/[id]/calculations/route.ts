/**
 * Расчёты из калькулятора «Бот-Инженер» по этому заказу.
 *
 * GET  — что посчитано с номером этого заказа (см. lib/own-crm/calc-link.ts).
 * POST — взять расчёт в состав заказа: добавляем позицию с ценой калькулятора.
 *
 * Позиция добавляется к уже существующему составу, а не вместо него: правка
 * состава в RetailCRM передаётся целиком, и потеря старых позиций была бы
 * молчаливой.
 */
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getSession } from '@/lib/auth';
import { supabase } from '@/utils/supabase';
import { calculationsForOrder } from '@/lib/own-crm/calc-link';
import { editOrder, type EditableItem } from '@/lib/own-crm/edit-order';

export const dynamic = 'force-dynamic';

const bodySchema = z.object({
    type: z.string().trim().min(1).max(40),
    id: z.string().trim().min(1).max(64),
});

/** Заказ ищем по номеру RetailCRM — так его открывает карточка. */
async function findOrder(id: string) {
    const { data } = await supabase
        .from('orders')
        .select('id, order_id, number, raw_payload')
        .eq('order_id', id)
        .maybeSingle();
    return (data as any) ?? null;
}

/** Текущий состав заказа в том виде, в каком его принимает правка. */
function currentItems(order: any): EditableItem[] {
    const items = (order?.raw_payload?.items ?? []) as any[];
    return items.map((item) => ({
        id: Number(item.id) || null,
        name: String(item.offer?.name || item.productName || 'Позиция'),
        quantity: Number(item.quantity) || 1,
        price: Number(item.price) || Number(item.initialPrice) || 0,
        xmlId: item.offer?.xmlId ? String(item.offer.xmlId) : null,
    }));
}

export async function GET(_request: Request, { params }: { params: { id: string } }) {
    const session = await getSession();
    if (!session?.user) return NextResponse.json({ error: 'Неавторизован' }, { status: 401 });

    const order = await findOrder(params.id);
    if (!order) return NextResponse.json({ error: 'Заказ не найден' }, { status: 404 });

    const orderNumber = String(order.number ?? order.order_id);
    const result = await calculationsForOrder(orderNumber);

    // Что уже в составе — чтобы не предлагать взять одно и то же дважды.
    const inOrder = new Set(currentItems(order).map((item) => item.name.trim().toLowerCase()));

    return NextResponse.json({
        orderNumber,
        available: result.available,
        reason: result.available ? null : result.reason,
        items: result.items.map((item) => ({ ...item, inOrder: inOrder.has(item.title.trim().toLowerCase()) })),
    });
}

export async function POST(request: Request, { params }: { params: { id: string } }) {
    const session = await getSession();
    if (!session?.user) return NextResponse.json({ error: 'Неавторизован' }, { status: 401 });

    const parsed = bodySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
        return NextResponse.json({ error: 'Не понял, какой расчёт брать' }, { status: 400 });
    }

    const order = await findOrder(params.id);
    if (!order) return NextResponse.json({ error: 'Заказ не найден' }, { status: 404 });

    const orderNumber = String(order.number ?? order.order_id);
    const found = await calculationsForOrder(orderNumber);
    if (!found.available) {
        return NextResponse.json({ error: found.reason }, { status: 409 });
    }

    const calculation = found.items.find((item) => item.type === parsed.data.type && item.id === parsed.data.id);
    if (!calculation) {
        return NextResponse.json({ error: 'Такого расчёта по этому заказу нет' }, { status: 404 });
    }
    if (calculation.price <= 0) {
        return NextResponse.json(
            { error: 'В расчёте нет цены — посчитайте его в калькуляторе заново' },
            { status: 409 },
        );
    }

    const result = await editOrder(Number(order.id), {
        items: [
            ...currentItems(order),
            {
                name: calculation.title,
                quantity: calculation.quantity,
                price: calculation.price,
            },
        ],
    });

    if (!result.ok) {
        return NextResponse.json({ error: result.reason }, { status: 409 });
    }

    return NextResponse.json({ ok: true, added: calculation.title, price: calculation.price });
}
