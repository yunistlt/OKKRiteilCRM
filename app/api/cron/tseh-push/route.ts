import { isCronAuthorized } from '@/lib/cron-auth';
import { NextRequest, NextResponse } from 'next/server';
import postgres from 'postgres';
import { backfillProductionImages, pushProductionQueue } from '@/lib/own-crm/tseh-push';

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
    // Полная проверка, а не только заголовки: администратор должен иметь возможность
    // запустить отправку руками из браузера — например, пропустить первый заказ и
    // посмотреть результат, прежде чем открывать поток расписанием.
    if (!(await isCronAuthorized(req))) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const connectionString = process.env.DATABASE_URL || process.env.POSTGRES_URL;
    if (!connectionString) {
        return NextResponse.json({ ok: false, error: 'Нет DATABASE_URL' }, { status: 500 });
    }

    const sql = postgres(connectionString);
    try {
        // ?limit=N — прогнать ограниченную партию вручную (первый заказ при включении связи).
        const limit = Number(req.nextUrl.searchParams.get('limit')) || undefined;
        // ?images=1 — досылка фото и ссылок по уже заведённым заказам вместо обычной отдачи
        // очереди. Разовая работа по хвосту: заказы, уехавшие до 12.10.2026, стоят в
        // ЦехУспехе без картинок. Гонять партиями, пока `taken` не станет нулём.
        if (req.nextUrl.searchParams.get('images') === '1') {
            // ?order=54776,54855 — переотправить названные заказы, даже если их уже досылали:
            // отметка говорит, что слали мы, а не что у них записалось.
            const orderNumbers = (req.nextUrl.searchParams.get('order') || '')
                .split(',')
                .map((value) => value.trim())
                .filter(Boolean);
            const images = await backfillProductionImages(sql, limit, orderNumbers);
            return NextResponse.json({ ok: true, ...images });
        }
        const report = await pushProductionQueue(sql, limit);
        return NextResponse.json({ ok: true, ...report });
    } catch (e) {
        const error = e instanceof Error ? e.message : String(e);
        return NextResponse.json({ ok: false, error }, { status: 500 });
    } finally {
        await sql.end({ timeout: 5 });
    }
}
