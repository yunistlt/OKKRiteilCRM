/**
 * Поиск групп компаний по названию — чтобы присоединить карточку к уже
 * заведённой группе, а не плодить одинаковые (решение владельца 06.10.2026).
 */
import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { searchGroups } from '@/lib/own-crm/company-groups';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: 'Неавторизован' }, { status: 401 });

    const q = new URL(req.url).searchParams.get('q') ?? '';
    return NextResponse.json({ groups: await searchGroups(q) });
}
