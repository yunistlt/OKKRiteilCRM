import { NextRequest, NextResponse } from 'next/server';
import { parkQueue, releaseQueue, returnQueue } from '@/lib/sales-rop/queue';
import { localToday } from '@/app/api/cron/rop-morning/route';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

// GET /api/cron/rop-queue?mode=park|release|return — конвейер заявок.
//
// park    — ночью: заказы дневного плана уезжают на пользователя-пул;
// release — днём каждые 15 минут: пачка возвращается менеджеру, следующая
//           поедет, когда по выданным появится касание;
// return  — вечером: всё, что не дошло, возвращается владельцу. Ночевать в
//           пуле заказ не должен — утром человек не найдёт свою заявку.

export async function GET(req: NextRequest) {
    const auth = req.headers.get('authorization');
    if (process.env.CRON_SECRET && auth !== `Bearer ${process.env.CRON_SECRET}`) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const mode = req.nextUrl.searchParams.get('mode') || 'release';
    const dryRun = req.nextUrl.searchParams.get('dry') === '1';
    const date = req.nextUrl.searchParams.get('date') || localToday();

    try {
        if (mode === 'park') return NextResponse.json({ ok: true, mode, date, ...(await parkQueue(date, { dryRun })) });
        if (mode === 'return') return NextResponse.json({ ok: true, mode, date, ...(await returnQueue(date, { dryRun })) });
        return NextResponse.json({ ok: true, mode: 'release', date, ...(await releaseQueue(date, { dryRun })) });
    } catch (e: any) {
        return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
    }
}
