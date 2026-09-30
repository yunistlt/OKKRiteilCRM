/**
 * Правка заказа менеджером: состав, комментарии, статус, доп. поля.
 * Изменения уходят в RetailCRM, пока она остаётся источником правды по заказам.
 */
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getSession } from '@/lib/auth';
import { editOrder } from '@/lib/own-crm/edit-order';

export const dynamic = 'force-dynamic';

const itemSchema = z.object({
    id: z.coerce.number().int().positive().optional().nullable(),
    name: z.string().trim().min(1),
    quantity: z.coerce.number().positive(),
    price: z.coerce.number().min(0),
    xmlId: z.string().trim().optional().nullable(),
});

const bodySchema = z.object({
    items: z.array(itemSchema).optional(),
    customerComment: z.string().max(5000).optional().nullable(),
    managerComment: z.string().max(5000).optional().nullable(),
    statusCode: z.string().trim().max(100).optional().nullable(),
    managerId: z.coerce.number().int().positive().optional().nullable(),
    customFields: z.record(z.string(), z.any()).optional(),
});

export async function POST(request: Request, { params }: { params: { id: string } }) {
    const session = await getSession();
    if (!session?.user) {
        return NextResponse.json({ error: 'Неавторизован' }, { status: 401 });
    }

    const orderRowId = Number(params.id);
    if (!Number.isFinite(orderRowId)) {
        return NextResponse.json({ error: 'Неверный номер заказа' }, { status: 400 });
    }

    let payload: unknown;
    try {
        payload = await request.json();
    } catch {
        return NextResponse.json({ error: 'Не удалось прочитать данные формы' }, { status: 400 });
    }

    const parsed = bodySchema.safeParse(payload);
    if (!parsed.success) {
        return NextResponse.json({ error: 'Правка заполнена неверно', details: parsed.error.issues }, { status: 400 });
    }

    const result = await editOrder(orderRowId, parsed.data as any);
    if (!result.ok) {
        return NextResponse.json({ error: result.reason }, { status: 409 });
    }

    return NextResponse.json({ ok: true, changed: result.changed });
}
