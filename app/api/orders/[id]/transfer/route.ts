/**
 * Перевод заказа другому менеджеру — самими менеджерами, с обязательной
 * причиной (решение владельца 05.10.2026).
 */
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getSession } from '@/lib/auth';
import { transferOrderManager } from '@/lib/own-crm/manager-transfer';

export const dynamic = 'force-dynamic';

const bodySchema = z.object({
    toManagerId: z.coerce.number().int().positive(),
    reason: z.string().trim().min(1).max(2000),
});

export async function POST(request: Request, { params }: { params: { id: string } }) {
    const session = await getSession();
    if (!session?.user) return NextResponse.json({ error: 'Неавторизован' }, { status: 401 });

    const orderKey = Number(params.id);
    if (!Number.isFinite(orderKey)) {
        return NextResponse.json({ error: 'Неверный номер заказа' }, { status: 400 });
    }

    const parsed = bodySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
        return NextResponse.json({ error: 'Укажите менеджера и причину перевода' }, { status: 400 });
    }

    const result = await transferOrderManager({
        orderKey,
        toManagerId: parsed.data.toManagerId,
        reason: parsed.data.reason,
        actor: session.user.email || session.user.username || null,
    });

    if (!result.ok) return NextResponse.json({ error: result.reason }, { status: 409 });
    return NextResponse.json({ ok: true, manager: result.toManagerName });
}
