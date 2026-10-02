/**
 * Реквизиты клиента: читаем и сохраняем в его карточке.
 * В заказ они подтягиваются отсюда (решение владельца 02.10.2026).
 */
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getSession } from '@/lib/auth';
import { loadClientRequisites, saveClientRequisites } from '@/lib/own-crm/client-requisites';

export const dynamic = 'force-dynamic';

const bodySchema = z.object({
    contragentType: z.string().trim().max(60).optional().nullable(),
    legalName: z.string().trim().max(500).optional().nullable(),
    inn: z.string().trim().max(20).optional().nullable(),
    kpp: z.string().trim().max(20).optional().nullable(),
    ogrn: z.string().trim().max(20).optional().nullable(),
    ogrnip: z.string().trim().max(20).optional().nullable(),
    legalAddress: z.string().trim().max(500).optional().nullable(),
    bank: z.string().trim().max(300).optional().nullable(),
    bankAccount: z.string().trim().max(40).optional().nullable(),
    bik: z.string().trim().max(20).optional().nullable(),
    corrAccount: z.string().trim().max(40).optional().nullable(),
    bankAddress: z.string().trim().max(300).optional().nullable(),
});

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
    const session = await getSession();
    if (!session?.user) return NextResponse.json({ error: 'Неавторизован' }, { status: 401 });

    const { id } = await params;
    return NextResponse.json({ ok: true, requisites: await loadClientRequisites(id) });
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
    const session = await getSession();
    if (!session?.user) return NextResponse.json({ error: 'Неавторизован' }, { status: 401 });

    const { id } = await params;
    const parsed = bodySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
        return NextResponse.json({ error: 'Реквизиты заполнены неверно', details: parsed.error.issues }, { status: 400 });
    }

    try {
        await saveClientRequisites(id, parsed.data, session.user.email || session.user.username || null);
        return NextResponse.json({ ok: true, requisites: await loadClientRequisites(id) });
    } catch (e: any) {
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}
