/**
 * Правка данных человека (контактного лица) в ОКК.
 *
 * Решение владельца 02.10.2026: ФИО, телефоны и почту правим у себя, в
 * RetailCRM не отправляем. Запись помечается (`customers.okk_edited_at`), и
 * синхронизация контактов её личные поля больше не перезаписывает.
 */
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getSession } from '@/lib/auth';
import { loadPerson, savePerson } from '@/lib/own-crm/client-people';

export const dynamic = 'force-dynamic';

const bodySchema = z.object({
    lastName: z.string().trim().max(100).optional().nullable(),
    firstName: z.string().trim().max(100).optional().nullable(),
    patronymic: z.string().trim().max(100).optional().nullable(),
    email: z.string().trim().max(200).optional().nullable(),
    phones: z.array(z.string().trim().max(40)).max(5).optional(),
});

export async function GET(_request: Request, { params }: { params: Promise<{ contactId: string }> }) {
    const session = await getSession();
    if (!session?.user) return NextResponse.json({ error: 'Неавторизован' }, { status: 401 });

    const { contactId } = await params;
    const person = await loadPerson(contactId);
    if (!person) return NextResponse.json({ error: 'Человек не найден' }, { status: 404 });

    return NextResponse.json({ ok: true, person });
}

export async function POST(request: Request, { params }: { params: Promise<{ contactId: string }> }) {
    const session = await getSession();
    if (!session?.user) return NextResponse.json({ error: 'Неавторизован' }, { status: 401 });

    const { contactId } = await params;
    const parsed = bodySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
        return NextResponse.json({ error: 'Данные заполнены неверно', details: parsed.error.issues }, { status: 400 });
    }

    try {
        const person = await savePerson(contactId, parsed.data, session.user.email || session.user.username || null);
        return NextResponse.json({ ok: true, person });
    } catch (e: any) {
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}
