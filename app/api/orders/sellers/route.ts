/**
 * Наши юрлица, от которых можно завести заказ или выставить документы.
 * Это магазины в RetailCRM: у каждого свои реквизиты и банковские счета.
 *
 * Маршрут общий, не по заказу: список один и тот же и в карточке заказа, и в
 * форме нового заказа — там заказа ещё нет (просьба Евгении Матвеевой
 * 16.10.2026: «нет выбора юр лица (ЗМК/ПОБТ)»).
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
