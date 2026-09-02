import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { revokeAccess } from '@/lib/shtab/google/oauth';

export const dynamic = 'force-dynamic';

// POST /api/shtab/google/revoke — отключить календарь.
//
// Отзываем право у Google, а не только забываем токен у себя: иначе выданный
// доступ останется висеть в аккаунте владельца. Календарь «Ритм Штаба» и все
// заведённые встречи остаются у него — их мы не трогаем.

export async function POST(req: NextRequest) {
    try {
        const session = await getSession(req);
        if (!session?.user) return NextResponse.json({ error: 'Неавторизован' }, { status: 401 });
        await revokeAccess();
        return NextResponse.json({ ok: true });
    } catch (e: any) {
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}
