import { NextResponse } from 'next/server';
import { supabase } from '@/utils/supabase';

export const dynamic = 'force-dynamic';

export async function GET() {
    try {
        // 1. Get IDs of working statuses
        const { data: workingSettings } = await supabase
            .from('status_settings')
            .select('code')
            .eq('is_working', true);

        const workingCodes = (workingSettings || []).map(s => s.code);

        // Limit to 50 items for '.in()' filter to be safe, or just pass array
        // Supabase handles arrays fine usually.

        // 2. Count "Working Orders"
        const { count: workingOrdersCount, error: e1 } = await supabase
            .from('orders')
            .select('*', { count: 'exact', head: true })
            .in('status', workingCodes);

        if (e1) throw e1;

        // 3. Count "Matched Calls" (calls linked to working orders)
        // We use !inner join to filter calls by the related order's status

        const { count: matchedCallsCount, error: e2 } = await supabase
            .from('raw_telphin_calls')
            .select(`
                telphin_call_id,
                call_order_matches!inner (
                    orders!inner (
                        status
                    )
                )
            `, { count: 'exact', head: true })
            .in('call_order_matches.orders.status', workingCodes);

        if (e2) throw e2;

        // 4. Count "Transcribed Matches" (linked to working orders + transcript exists)
        // raw_telphin_calls.raw_payload->transcript is not null
        const { count: transcribedCount, error: e3 } = await supabase
            .from('raw_telphin_calls')
            .select(`
                telphin_call_id,
                call_order_matches!inner (
                    orders!inner (
                        status
                    )
                )
            `, { count: 'exact', head: true })
            .in('call_order_matches.orders.status', workingCodes)
            .not('raw_payload->transcript', 'is', null);

        if (e3) throw e3;

        // 5. Count "Pending Matches" (linked to working orders + transcript is null)
        const { count: pendingCount, error: e4 } = await supabase
            .from('raw_telphin_calls')
            .select(`
                telphin_call_id,
                call_order_matches!inner (
                    orders!inner (
                        status
                    )
                )
            `, { count: 'exact', head: true })
            .in('call_order_matches.orders.status', workingCodes)
            .is('raw_payload->transcript', null);

        if (e4) throw e4;

        return NextResponse.json({
            ok: true,
            stats: {
                workingOrders: workingOrdersCount || 0,
                matchedCalls: matchedCallsCount || 0,
                transcribedCalls: transcribedCount || 0,
                pendingCalls: pendingCount || 0
            }
        });

    } catch (e: any) {
        console.error('[SystemStats API] Error:', e);
        return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
    }
}
