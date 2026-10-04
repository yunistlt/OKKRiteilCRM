import { isCronHeaderAuthorized } from '@/lib/cron-auth';
import { NextRequest, NextResponse } from 'next/server';
import postgres from 'postgres';
import { pushProductionQueue } from '@/lib/own-crm/tseh-push';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

// GET /api/cron/tseh-push — отдаём очередь заказов в ЦехУспех.
//
// Каждые несколько минут, потому что заказ, переведённый в производство, в цехе ждут сегодня,
// а не завтра. Проход по пустой очереди стоит один запрос к своей же базе, поэтому частота
// ничего не стоит.
//
// Заказы, которые не доехали из-за связи, остаются в очереди и уедут следующим проходом —
// повторная отправка у них дубля не создаёт. Подробности: docs/tseh-integration/OVERVIEW.md.

export async function GET(req: NextRequest) {
    if (!isCronHeaderAuthorized(req)) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const connectionString = process.env.DATABASE_URL || process.env.POSTGRES_URL;
    if (!connectionString) {
        return NextResponse.json({ ok: false, error: 'Нет DATABASE_URL' }, { status: 500 });
    }

    const sql = postgres(connectionString);
    try {
        const report = await pushProductionQueue(sql);
        return NextResponse.json({ ok: true, ...report });
    } catch (e) {
        const error = e instanceof Error ? e.message : String(e);
        return NextResponse.json({ ok: false, error }, { status: 500 });
    } finally {
        await sql.end({ timeout: 5 });
    }
}
