import { NextResponse } from 'next/server';
import { unstable_cache } from 'next/cache';
import { getSession } from '@/lib/auth';
import { OKK_CONSULTANT_GUIDES } from '@/lib/okk-consultant';

export const dynamic = 'force-dynamic';
export const revalidate = 3600;

const getCachedCriterion = unstable_cache(
    async (key: string) => OKK_CONSULTANT_GUIDES.find((item) => item.key === key) || null,
    ['okk-consultant-criterion'],
    { revalidate: 3600 }
);

export async function GET(_req: Request, { params }: { params: { key: string } }) {
    const session = await getSession();
    if (!session?.user) {
        return NextResponse.json({ error: 'Требуется авторизация' }, { status: 401 });
    }

    const criterion = await getCachedCriterion(params.key);
    if (!criterion) {
        return NextResponse.json({ error: 'Критерий не найден' }, { status: 404 });
    }

    return NextResponse.json({ criterion });
}
