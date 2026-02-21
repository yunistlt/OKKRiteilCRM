import { NextResponse } from 'next/server';
import { runFullEvaluation } from '@/lib/okk-evaluator';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

// GET /api/okk/run-all — полный прогон всех контролируемых заказов
// Запускается: ночным cron + кнопкой в UI
export async function GET(request: Request) {
    try {
        const { searchParams } = new URL(request.url);
        const limit = searchParams.get('limit') ? parseInt(searchParams.get('limit')!) : undefined;
        const specificOrderId = searchParams.get('orderId') ? parseInt(searchParams.get('orderId')!) : undefined;

        console.log(`[ОКК Cron] Starting evaluation run... limit=${limit}, orderId=${specificOrderId}`);
        const result = await runFullEvaluation({ limit, specificOrderId });
        console.log(`[ОКК Cron] Done: ${result.processed} processed, ${result.errors} errors`);
        return NextResponse.json({ success: true, ...result });
    } catch (e: any) {
        console.error('[ОКК Cron] Fatal error:', e);
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}
