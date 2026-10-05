/** Реквизиты по ИНН — чтобы не переписывать их руками. */
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getSession } from '@/lib/auth';
import { lookupByInn, lookupConfigured } from '@/lib/own-crm/requisites-lookup';

export const dynamic = 'force-dynamic';

const bodySchema = z.object({ inn: z.string().trim().min(10).max(12) });

export async function POST(request: Request) {
    const session = await getSession();
    if (!session?.user) return NextResponse.json({ error: 'Неавторизован' }, { status: 401 });

    if (!lookupConfigured()) {
        return NextResponse.json({ error: 'Поиск по ИНН не настроен — заполните реквизиты вручную' }, { status: 503 });
    }

    const parsed = bodySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
        return NextResponse.json({ error: 'Введите ИНН: 10 цифр у организации, 12 у ИП' }, { status: 400 });
    }

    const found = await lookupByInn(parsed.data.inn);
    if (!found) {
        return NextResponse.json({ error: 'По этому ИНН компания не нашлась' }, { status: 404 });
    }

    return NextResponse.json({ ok: true, ...found });
}
