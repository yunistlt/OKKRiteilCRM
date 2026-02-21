import { NextResponse } from 'next/server';
import { runFullEvaluation } from '@/lib/okk-evaluator';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

// GET /api/okk/run-all — полный прогон всех контролируемых заказов
// Запускается: ночным cron + кнопкой в UI
export async function GET(request: Request) {
    try {
        console.log('[ОКК Cron] Starting full evaluation run...');
        const result = await runFullEvaluation();
        console.log(`[ОКК Cron] Done: ${result.processed} processed, ${result.errors} errors`);
        return NextResponse.json({ success: true, ...result });
    } catch (e: any) {
        console.error('[ОКК Cron] Fatal error:', e);
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}
