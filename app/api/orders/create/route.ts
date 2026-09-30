/**
 * Создание заказа менеджером. Заказ заводится в RetailCRM, чтобы сразу попасть
 * в общий поток: производство, зарплата, ОКК и боты видят его как любой другой.
 */
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getSession } from '@/lib/auth';
import { createManagerOrder, validateNewOrder } from '@/lib/own-crm/create-order';

export const dynamic = 'force-dynamic';

const itemSchema = z.object({
    name: z.string().trim().min(1),
    quantity: z.coerce.number().positive(),
    price: z.coerce.number().min(0),
    article: z.string().trim().optional().nullable(),
    xmlId: z.string().trim().optional().nullable(),
});

const bodySchema = z.object({
    customerId: z.coerce.number().int().positive().optional().nullable(),
    contactName: z.string().trim().max(200).optional().nullable(),
    companyName: z.string().trim().max(300).optional().nullable(),
    inn: z.string().trim().max(20).optional().nullable(),
    phone: z.string().trim().max(50).optional().nullable(),
    email: z.string().trim().max(200).optional().nullable(),
    items: z.array(itemSchema).min(1),
    managerId: z.coerce.number().int().positive().optional().nullable(),
    customerComment: z.string().trim().max(5000).optional().nullable(),
    managerComment: z.string().trim().max(5000).optional().nullable(),
});

export async function POST(request: Request) {
    const session = await getSession();
    if (!session?.user) {
        return NextResponse.json({ error: 'Неавторизован' }, { status: 401 });
    }

    let payload: unknown;
    try {
        payload = await request.json();
    } catch {
        return NextResponse.json({ error: 'Не удалось прочитать данные формы' }, { status: 400 });
    }

    const parsed = bodySchema.safeParse(payload);
    if (!parsed.success) {
        return NextResponse.json({ error: 'Заказ заполнен не полностью', details: parsed.error.issues }, { status: 400 });
    }

    // Менеджер по умолчанию — тот, кто создаёт заказ.
    const order = {
        ...parsed.data,
        managerId: parsed.data.managerId ?? session.user.retail_crm_manager_id ?? null,
    };

    const problems = validateNewOrder(order as any);
    if (problems.length) {
        return NextResponse.json({ error: problems.join('; ') }, { status: 400 });
    }

    try {
        const created = await createManagerOrder(order as any);
        return NextResponse.json({ ok: true, ...created });
    } catch (error: any) {
        return NextResponse.json({ error: String(error?.message || error) }, { status: 502 });
    }
}
