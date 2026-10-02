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
    // Скидка позиции: рублями на единицу и/или процентом, как в RetailCRM.
    discountAmount: z.coerce.number().min(0).optional().nullable(),
    discountPercent: z.coerce.number().min(0).max(100).optional().nullable(),
    xmlId: z.string().trim().optional().nullable(),
    /** id товара на сайте и артикул — по ним название ведёт на карточку. */
    siteId: z.string().trim().max(40).optional().nullable(),
    article: z.string().trim().max(200).optional().nullable(),
});

const bodySchema = z.object({
    items: z.array(itemSchema).optional(),
    /** Разовая скидка на заказ. */
    discountAmount: z.coerce.number().min(0).optional().nullable(),
    discountPercent: z.coerce.number().min(0).max(100).optional().nullable(),
    customerComment: z.string().max(5000).optional().nullable(),
    managerComment: z.string().max(5000).optional().nullable(),
    statusCode: z.string().trim().max(100).optional().nullable(),
    managerId: z.coerce.number().int().positive().optional().nullable(),
    customFields: z.record(z.string(), z.any()).optional(),
    contact: z.record(z.string(), z.any()).optional(),
    /** Реквизиты заказчика — они живут на заказе, как в RetailCRM. */
    contragent: z.record(z.string(), z.any()).optional(),
    /** Другой заказчик: карточка клиента, которой принадлежит заказ. */
    customerId: z.coerce.number().int().positive().optional().nullable(),
    delivery: z.record(z.string(), z.any()).optional(),
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
