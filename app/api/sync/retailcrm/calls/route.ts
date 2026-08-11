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
        // (наполняет RC-привязки, убирает конфликтующие эвристические догадки).
        // ?since=ISO — окно разбора (по умолчанию функция берёт 7 дней). Большое
        // окно нужно только для разового бэкфилла, штатный прогон идёт по хвосту:
        // раньше окна не было, функция перебирала всю историю и падала по
        // statement timeout — см. миграцию 20260811.
        const sinceParam = searchParams.get('since');
        let reconcile: any = null;
        try {
            const { data, error } = await supabase.rpc('reconcile_retailcrm_call_matches',
                sinceParam ? { p_since: sinceParam } : {});
            if (error) throw error;
            reconcile = Array.isArray(data) ? data[0] : data;
        } catch (e: any) {
            // Молчаливый catch стоил двух месяцев: крон рапортовал успех, а привязок
            // не появлялось. Ошибку кладём в sync_state — она видна в /settings/status.
            console.error('[RetailcrmCallsSync] reconcile failed:', e?.message);
            reconcile = { error: e?.message || 'reconcile failed' };
            await supabase.from('sync_state').upsert(
                {
                    key: 'retailcrm_calls_reconcile_last_error',
                    value: e?.message || 'reconcile failed',
                    updated_at: new Date().toISOString(),
                },
                { onConflict: 'key' },
            );
        }
        if (!reconcile?.error) {
            await supabase.from('sync_state').upsert(
                {
                    key: 'retailcrm_calls_reconcile_last_success_at',
                    value: new Date().toISOString(),
                    updated_at: new Date().toISOString(),
                },
                { onConflict: 'key' },
            );
        }

        return NextResponse.json({ ...result, reconcile });
    } catch (error: any) {
        const isUnauthorized = error.message === 'Unauthorized';
        return NextResponse.json({ error: error.message }, { status: isUnauthorized ? 401 : 500 });
    }
}
