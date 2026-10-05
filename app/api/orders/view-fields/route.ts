/** Реестр колонок и полей фильтра: постоянные плюс поля карточки заказа. */
import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { viewRegistry } from '@/lib/orders-view-fields';

export const dynamic = 'force-dynamic';

export async function GET() {
    const session = await getSession();
    if (!session?.user) return NextResponse.json({ error: 'Неавторизован' }, { status: 401 });

    return NextResponse.json(await viewRegistry());
}
