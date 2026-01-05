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

        // 3. Count "Matched Calls" (TOTAL)
        // Changed to show ALL matches to verify system performance, not just active ones.
        const { count: matchedCallsCount, error: e2 } = await supabase
            .from('call_order_matches')
            .select('*', { count: 'exact', head: true });

        if (e2) throw e2;

        const { data: transcribableSettings } = await supabase
            .from('status_settings')
            .select('code')
            .eq('is_transcribable', true);

        const transcribableCodes = (transcribableSettings || []).map(s => s.code);

        // 4. Count "Transcribed Matches" (linked to TRANSCRIBABLE orders + transcript exists)
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
            .in('call_order_matches.orders.status', transcribableCodes)
            .or('transcript.not.is.null,raw_payload->>transcript.not.is.null');

        if (e3) throw e3;

        // 5. Count "Pending Matches" (linked to TRANSCRIBABLE orders + transcript is null)
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
            .in('call_order_matches.orders.status', transcribableCodes)
            .is('transcript', null)
            .is('raw_payload->transcript', null);

        if (e4) throw e4;

        return NextResponse.json({
            ok: true,
            version: 'v2-total-count',
            debug_table: 'call_order_matches',
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
