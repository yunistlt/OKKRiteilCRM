import { NextResponse } from 'next/server';
import { runFullEvaluation } from '@/lib/okk-evaluator';
import { getSession } from '@/lib/auth';
import { canAccessTargetManager, getEffectiveCapabilityForRole } from '@/lib/access-control-server';
import { supabase } from '@/utils/supabase';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

function hasCronAuthorization(req: Request) {
    const authHeader = req.headers.get('authorization');
    return !process.env.CRON_SECRET || authHeader === `Bearer ${process.env.CRON_SECRET}`;
}

// GET /api/okk/run-all — полный прогон всех контролируемых заказов
// Запускается: ночным cron + кнопкой в UI
export async function GET(request: Request) {
    try {
        const cronAuthorized = hasCronAuthorization(request);
        const session = cronAuthorized ? null : await getSession();
        const capability = cronAuthorized ? null : await getEffectiveCapabilityForRole(session?.user?.role);

        const { searchParams } = new URL(request.url);
        const limit = searchParams.get('limit') ? parseInt(searchParams.get('limit')!) : undefined;
        const specificOrderId = searchParams.get('orderId') ? parseInt(searchParams.get('orderId')!) : undefined;
        const force = searchParams.get('force') === 'true';

        if (process.env.ENABLE_SYSTEM_JOBS_PIPELINE === 'true' && !specificOrderId && !force) {
            return NextResponse.json({
                success: true,
                status: 'skipped',
                reason: 'Realtime pipeline owns production recalculation. Use force=true for emergency bulk fallback or orderId for single-order run.',
            });
        }

        if (!cronAuthorized && !capability?.canRunBulkOperations && !specificOrderId) {
            return NextResponse.json({ error: 'У вас нет прав на массовый запуск проверки' }, { status: 403 });
        }

        if (specificOrderId && !cronAuthorized) {
            const { data: order } = await supabase
                .from('orders')
                .select('manager_id')
                .eq('order_id', specificOrderId)
                .single();

            if (!order || !capability || !canAccessTargetManager(session?.user, capability, order.manager_id)) {
                return NextResponse.json({ error: 'У вас нет прав на перепроверку этого заказа' }, { status: 403 });
            }
        }

        console.log(`[ОКК Cron] Starting evaluation run... limit=${limit}, orderId=${specificOrderId}`);
        const result = await runFullEvaluation({ limit, specificOrderId });
        console.log(`[ОКК Cron] Done: ${result.processed} processed, ${result.errors} errors`);
        return NextResponse.json({ success: true, ...result });
    } catch (e: any) {
        console.error('[ОКК Cron] Fatal error:', e);
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}
