import { NextResponse } from 'next/server';
import { unstable_cache } from 'next/cache';
import { getSession } from '@/lib/auth';
import { getConsultantCatalog } from '@/lib/okk-consultant';

export const dynamic = 'force-dynamic';
export const revalidate = 3600;

const getCachedConsultantCatalog = unstable_cache(
    async () => getConsultantCatalog(),
    ['okk-consultant-catalog'],
    { revalidate: 3600 }
);

export async function GET() {
    const session = await getSession();
    if (!session?.user) {
        return NextResponse.json({ error: 'Требуется авторизация' }, { status: 401 });
    }

    return NextResponse.json(await getCachedConsultantCatalog());
}
