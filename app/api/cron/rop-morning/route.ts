import { NextRequest, NextResponse } from 'next/server';
import { runMorning } from '@/lib/sales-rop/service';

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
    const auth = req.headers.get('authorization');
    if (process.env.CRON_SECRET && auth !== `Bearer ${process.env.CRON_SECRET}`) {
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
        return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
    }
}

/**
 * Сегодня по заводскому времени. Тольятти — UTC+4 (самарское), а не московское:
 * час разницы решает, каким днём датирован план, запущенный ранним утром.
 */
export const TSEH_UTC_OFFSET_HOURS = 4;

export function localToday(now = new Date()): string {
    return new Date(now.getTime() + TSEH_UTC_OFFSET_HOURS * 60 * 60 * 1000).toISOString().slice(0, 10);
}
