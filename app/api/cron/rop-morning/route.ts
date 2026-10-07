import { isCronHeaderAuthorized } from '@/lib/cron-auth';
import { NextRequest, NextResponse } from 'next/server';
import { localToday } from '@/lib/sales-rop/local-day';
import { notifyOwnerFailure, runMorning } from '@/lib/sales-rop/service';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

// GET /api/cron/rop-morning — утренний план отдела продаж.
//
// Каждому менеджеру персональный список на день: висящие счета, просроченные
// обещания перезвонить, стоящие согласования. Публично, в общем чате, с тегом —
// так работает не бот, а то, что список видят коллеги.
//
// ?dry=1 — собрать и вернуть текст, ничего не отправляя и не записывая. Нужно,
// чтобы форму сообщения можно было согласовать, не будя отдел продаж.

export async function GET(req: NextRequest) {
    if (!isCronHeaderAuthorized(req)) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const dryRun = req.nextUrl.searchParams.get('dry') === '1';
    // Дата берётся по времени Тольятти: крон Vercel живёт в UTC, и в девять
    // утра на заводе там ещё предыдущие сутки.
    const today = req.nextUrl.searchParams.get('date') || localToday();

    try {
        const result = await runMorning(today, { dryRun });
        return NextResponse.json({ ok: true, ...result });
    } catch (e: any) {
        // Молчащий бот неотличим от бота без работы: о поломке сообщаем сами.
        if (!dryRun) await notifyOwnerFailure('Утренний план', e.message);
        return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
    }
}


