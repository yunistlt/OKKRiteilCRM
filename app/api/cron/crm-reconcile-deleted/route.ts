import { NextRequest, NextResponse } from 'next/server';
import { reconcileDeletedOrders } from '@/lib/retailcrm/reconcile-deleted';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

// GET /api/cron/crm-reconcile-deleted — сверка «жив ли заказ в CRM».
//
// Идёт по кругу пачками: за прогон проверяем самых давно не проверенных, за
// сутки обходим всю базу. Быстрее не нужно — удаление заказа не та новость,
// ради которой стоит долбить CRM каждую минуту.
export async function GET(req: NextRequest) {
    const auth = req.headers.get('authorization');
    if (process.env.CRON_SECRET && auth !== `Bearer ${process.env.CRON_SECRET}`) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    try {
        const batch = Number(new URL(req.url).searchParams.get('batch') || '') || undefined;
        const result = await reconcileDeletedOrders(batch);
        return NextResponse.json({ ok: true, ...result });
    } catch (e: any) {
        return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
    }
}
