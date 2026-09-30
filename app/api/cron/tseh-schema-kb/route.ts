import { isCronHeaderAuthorized } from '@/lib/cron-auth';
import { NextRequest, NextResponse } from 'next/server';
import postgres from 'postgres';
import { generateEmbedding } from '@/lib/embeddings';
import { syncTsehSchemaToKb } from '@/lib/shtab/tseh-schema-kb';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

// GET /api/cron/tseh-schema-kb — ночной снимок схемы ЦехУспеха в знания Тамары.
//
// Раз в сутки: база завода живёт своей жизнью, таблицы в ней появляются и
// меняются, а Тамара пишет по ней запросы. Ручной снимок протухает молча —
// запрос уходит по колонке, которой больше нет, и это видно только по ошибке
// в разговоре.
//
// Ночью, потому что чужая база рабочая, и лишний обход information_schema днём
// ей ни к чему. Раз в сутки, а не чаще, по той же причине: схема меняется
// редко, а учётка Тамары живёт с потолком в 5000 запросов в час.
//
// Денег этот крон почти не стоит: если схема не изменилась, отпечатки совпадут
// и ни одного эмбеддинга не считается. Платим только за то, что действительно
// поменялось.

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
        const report = await syncTsehSchemaToKb(sql, generateEmbedding);

        // Пропуск — это не успех и не сбой: база завода может быть не подключена
        // в этом окружении, и крон не должен изображать работу.
        if (report.skipped) {
            return NextResponse.json({ ok: true, skipped: report.skipped });
        }

        return NextResponse.json({
            ok: true,
            tables: report.tables,
            inserted: report.inserted.length,
            updated: report.updated.length,
            unchanged: report.unchanged.length,
            deactivated: report.deactivated.length,
        });
    } catch (e: any) {
        return NextResponse.json({ ok: false, error: e?.message ?? String(e) }, { status: 500 });
    } finally {
        await sql.end({ timeout: 5 });
    }
}
