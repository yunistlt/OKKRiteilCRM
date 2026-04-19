import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { getConsultantCatalog } from '@/lib/okk-consultant';

export const dynamic = 'force-dynamic';

export async function GET() {
    const session = await getSession();
    if (!session?.user) {
        return NextResponse.json({ error: 'Требуется авторизация' }, { status: 401 });
    }

    return NextResponse.json(await getConsultantCatalog());
}
