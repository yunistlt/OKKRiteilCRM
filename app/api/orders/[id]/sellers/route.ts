/**
 * Наши юрлица, от которых можно выставить счёт или КП.
 * Это магазины в RetailCRM: у каждого свои реквизиты и банковские счета.
 */
import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { sellerOptions } from '@/lib/own-crm/documents';

export const dynamic = 'force-dynamic';

export async function GET() {
    const session = await getSession();
    if (!session?.user) {
        return NextResponse.json({ error: 'Неавторизован' }, { status: 401 });
    }

    return NextResponse.json({ sellers: await sellerOptions().catch(() => []) });
}
