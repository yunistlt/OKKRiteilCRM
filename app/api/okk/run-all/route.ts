import { NextResponse } from 'next/server';
import { runFullEvaluation } from '@/lib/okk-evaluator';
import { getSession } from '@/lib/auth';
import { canAccessTargetManager, getEffectiveCapabilityForRole } from '@/lib/access-control-server';
import { supabase } from '@/utils/supabase';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

// GET /api/okk/run-all — полный прогон всех контролируемых заказов
// Запускается: ночным cron + кнопкой в UI
export async function GET(request: Request) {
    try {
        const session = await getSession();
        const userRole = session?.user?.role || 'admin';
        const retailCrmId = session?.user?.retail_crm_manager_id;
        const capability = await getEffectiveCapabilityForRole(session?.user?.role);

        const { searchParams } = new URL(request.url);
        const limit = searchParams.get('limit') ? parseInt(searchParams.get('limit')!) : undefined;
        const specificOrderId = searchParams.get('orderId') ? parseInt(searchParams.get('orderId')!) : undefined;

        if (!capability.canRunBulkOperations && !specificOrderId) {
            return NextResponse.json({ error: 'У вас нет прав на массовый запуск проверки' }, { status: 403 });
        }

        if (specificOrderId) {
            const { data: order } = await supabase
                .from('orders')
                .select('manager_id')
                .eq('order_id', specificOrderId)
                .single();

            if (!order || !canAccessTargetManager(session?.user, capability, order.manager_id)) {
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
