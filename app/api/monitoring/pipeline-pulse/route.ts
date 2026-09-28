/**
 * GET /api/monitoring/pipeline-pulse
 *
 * Пульс автомата для ВНЕШНЕГО сторожа (крон на VPS, ops/watchdog/). Публичный —
 * как и остальной /api/monitoring: отдаёт только отметки времени и нормативы,
 * ни одной строки клиентских данных.
 *
 * HTTP-код намеренно разный: 200 — конвейер жив, 503 — что-то встало. Так сторожу
 * достаточно кода ответа, а подробности он берёт из тела и пересылает владельцу.
 */
import { NextResponse } from 'next/server';
import { collectPipelinePulse } from '@/lib/pipeline-pulse';

export const dynamic = 'force-dynamic';

export async function GET() {
    try {
        const pulse = await collectPipelinePulse();
        return NextResponse.json(pulse, { status: pulse.ok ? 200 : 503 });
    } catch (error: any) {
        // Сломался сам снимок — это тоже авария, и молчать о ней нельзя.
        return NextResponse.json(
            {
                ok: false,
                checkedAt: new Date().toISOString(),
                problems: [`Пульс не собрался: ${error?.message || 'неизвестная ошибка'}`],
                checks: [],
            },
            { status: 503 },
        );
    }
}
