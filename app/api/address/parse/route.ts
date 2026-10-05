/** Разбор скопированного адреса на область, город, индекс и улицу. */
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getSession } from '@/lib/auth';
import { addressParseConfigured, parseAddress } from '@/lib/own-crm/address-parse';

export const dynamic = 'force-dynamic';

const bodySchema = z.object({ address: z.string().trim().min(3).max(500) });

export async function POST(request: Request) {
    const session = await getSession();
    if (!session?.user) return NextResponse.json({ error: 'Неавторизован' }, { status: 401 });

    if (!addressParseConfigured()) {
        return NextResponse.json({ error: 'Разбор адреса не настроен — заполните части вручную' }, { status: 503 });
    }

    const parsed = bodySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
        return NextResponse.json({ error: 'Напишите адрес — его и разберём' }, { status: 400 });
    }

    const parts = await parseAddress(parsed.data.address);
    if (!parts.address) {
        return NextResponse.json({ error: 'Такой адрес не распознан — проверьте написание' }, { status: 404 });
    }

    return NextResponse.json({ ok: true, parts });
}
