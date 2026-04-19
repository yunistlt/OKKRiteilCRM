import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { OKK_CONSULTANT_GUIDES } from '@/lib/okk-consultant';

export const dynamic = 'force-dynamic';

export async function GET(_req: Request, { params }: { params: { key: string } }) {
    const session = await getSession();
    if (!session?.user) {
        return NextResponse.json({ error: 'Требуется авторизация' }, { status: 401 });
    }

    const criterion = OKK_CONSULTANT_GUIDES.find((item) => item.key === params.key) || null;
    if (!criterion) {
        return NextResponse.json({ error: 'Критерий не найден' }, { status: 404 });
    }

    return NextResponse.json({ criterion });
}
