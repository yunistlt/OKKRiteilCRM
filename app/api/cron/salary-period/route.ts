import { isCronHeaderAuthorized } from '@/lib/cron-auth';
import { NextRequest, NextResponse } from 'next/server';
import { ensurePeriodForMonth } from '@/lib/salary/period-view';

export const dynamic = 'force-dynamic';

/**
 * GET /api/cron/salary-period — период зарплаты заводится сам.
 *
 * Первого числа месяц должен открываться без участия человека: раньше период
 * появлялся только при первом нажатии «Пересчитать», и до этого ведомость была
 * пустой, хотя заказы уже шли в производство.
 *
 * Ходим каждый день, а не только первого: если первого числа выкатка или сбой
 * съели прогон, месяц всё равно откроется назавтра. Вызов идемпотентный.
 */
export async function GET(req: NextRequest) {
    if (!isCronHeaderAuthorized(req)) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    try {
        const now = new Date();
        const id = await ensurePeriodForMonth(now.getFullYear(), now.getMonth() + 1);
        return NextResponse.json({ ok: true, year: now.getFullYear(), month: now.getMonth() + 1, periodId: id });
    } catch (e: any) {
        return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
    }
}
