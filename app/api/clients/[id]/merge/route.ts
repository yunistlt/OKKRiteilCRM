/**
 * Объединение карточек одного юрлица.
 *
 * Зовётся из карточки клиента, когда ИНН уже стоит в другой карточке: человек
 * видит, в какой именно, и решает сам (закон «одно юрлицо — одна карточка»).
 */
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getSession } from '@/lib/auth';
import { mergeClients } from '@/lib/own-crm/merge-clients';

export const dynamic = 'force-dynamic';

const BodySchema = z.object({
    /** Номер карточки, В КОТОРУЮ сливаем: в ней остаётся вся работа. */
    into: z.union([z.string(), z.number()]),
});

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
    const session = await getSession();
    if (!session?.user) return NextResponse.json({ error: 'Неавторизован' }, { status: 401 });

    const { id } = await params;
    const parsed = BodySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: 'Не указана карточка, в которую объединяем' }, { status: 400 });

    try {
        const actor = session.user.email || session.user.username || null;
        const result = await mergeClients(parsed.data.into, id, actor);
        return NextResponse.json({
            ok: true,
            ...result,
            message: `Карточки объединены: заказов перенесено ${result.movedOrders}, `
                + `контактных лиц ${result.movedContacts}. Работаем в карточке №${result.mainId}.`,
        });
    } catch (e: any) {
        return NextResponse.json({ error: e.message }, { status: 409 });
    }
}
