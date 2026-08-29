import { NextRequest, NextResponse } from 'next/server';
import { runEvening } from '@/lib/sales-rop/service';
import { moscowToday } from '@/app/api/cron/rop-morning/route';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

// GET /api/cron/rop-evening — вечерняя сверка утреннего плана.
//
// По каждой утренней задаче смотрим, было ли за день касание: комментарий,
// смена статуса, перенос даты контакта, письмо или звонок. Сверяется именно
// утренний список, сохранённый в базе, а не пересобранный заново — иначе отчёт
// проверял бы не то, что просили.

export async function GET(req: NextRequest) {
    const auth = req.headers.get('authorization');
    if (process.env.CRON_SECRET && auth !== `Bearer ${process.env.CRON_SECRET}`) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const dryRun = req.nextUrl.searchParams.get('dry') === '1';
    const today = req.nextUrl.searchParams.get('date') || moscowToday();

    try {
        const result = await runEvening(today, { dryRun });
        return NextResponse.json({ ok: true, ...result });
    } catch (e: any) {
        return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
    }
}
