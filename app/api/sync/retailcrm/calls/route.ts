import { NextResponse } from 'next/server';
import { ingestRetailcrmCalls, isRetailcrmCallsConfigured } from '@/lib/retailcrm/calls';
import { supabase } from '@/utils/supabase';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

function ensureAuthorized(req: Request) {
    const authHeader = req.headers.get('authorization');
    if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
        throw new Error('Unauthorized');
    }
}

// Ингест инвентаря звонков из RetailCRM в retailcrm_calls.
// ?full=true       — игнорировать курсор и тянуть от ?days (полный ре-синк)
// ?days=N          — горизонт первого/полного прогона (по умолчанию 120)
export async function GET(request: Request) {
    try {
        ensureAuthorized(request);

        if (!isRetailcrmCallsConfigured()) {
            return NextResponse.json({ error: 'RetailCRM config missing (RETAILCRM_URL/RETAILCRM_API_KEY)' }, { status: 500 });
        }

        const { searchParams } = new URL(request.url);
        const fullResync = searchParams.get('full') === 'true';
        const daysParam = searchParams.get('days');
        const sinceDays = daysParam ? Math.max(1, parseInt(daysParam, 10) || 120) : undefined;

        const result = await ingestRetailcrmCalls({ fullResync, sinceDays });

        if (!result.success) {
            return NextResponse.json({ error: result.error, ...result }, { status: 500 });
        }

        // После ингеста — авторитетная пересвязка звонок→заказ из RetailCRM в call_order_matches
        // (наполняет RC-привязки, убирает конфликтующие эвристические догадки). Best-effort:
        // сбой реконсиляции не должен валить успешный ингест.
        let reconcile: any = null;
        try {
            const { data, error } = await supabase.rpc('reconcile_retailcrm_call_matches');
            if (error) throw error;
            reconcile = Array.isArray(data) ? data[0] : data;
        } catch (e: any) {
            console.error('[RetailcrmCallsSync] reconcile failed:', e?.message);
            reconcile = { error: e?.message || 'reconcile failed' };
        }

        return NextResponse.json({ ...result, reconcile });
    } catch (error: any) {
        const isUnauthorized = error.message === 'Unauthorized';
        return NextResponse.json({ error: error.message }, { status: isUnauthorized ? 401 : 500 });
    }
}
