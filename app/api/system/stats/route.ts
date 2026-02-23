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

        // 2. Count "Working Orders"
        const { count: workingOrdersCount, error: e1 } = await supabase
            .from('orders')
            .select('*', { count: 'exact', head: true })
            .in('status', workingCodes);

        if (e1) throw e1;

        // 3. Count "Matched Calls" (TOTAL)
        const { count: matchedCallsCount, error: e2 } = await supabase
            .from('call_order_matches')
            .select('*', { count: 'exact', head: true });

        if (e2) throw e2;

        const { data: transcribableSettings } = await supabase
            .from('status_settings')
            .select('code')
            .eq('is_transcribable', true);

        const transcribableCodes = (transcribableSettings || []).map(s => s.code);

        // 4. Count "Transcribed Matches"
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

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
            .gte('started_at', thirtyDaysAgo.toISOString())
            .or('transcript.not.is.null,raw_payload->>transcript.not.is.null');

        if (e3) throw e3;

        // 5. Count "Pending Matches"
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
            .gte('started_at', thirtyDaysAgo.toISOString())
            .is('transcript', null)
            .is('raw_payload->transcript', null);

        if (e4) throw e4;

        // 6. Hourly Trends for the last 24 hours
        const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

        // 6.1 Matches Trend
        const { data: matchedTrend } = await supabase
            .from('call_order_matches')
            .select('matched_at')
            .gte('matched_at', twentyFourHoursAgo);

        // 6.2 Transcriptions Trend
        const { data: transcribedTrend } = await supabase
            .from('raw_telphin_calls')
            .select('started_at')
            .gte('started_at', twentyFourHoursAgo)
            .not('transcript', 'is', null);

        // 6.3 Evaluations Trend
        const { data: evalTrend } = await supabase
            .from('okk_order_scores')
            .select('eval_date')
            .gte('eval_date', twentyFourHoursAgo);

        const groupStatsByHour = (data: any[] | null, key: string) => {
            const counts: Record<number, number> = {};
            const now = new Date();
            for (let i = 0; i < 24; i++) {
                const hour = new Date(now.getTime() - i * 3600000).getHours();
                counts[hour] = 0;
            }

            data?.forEach(item => {
                const hour = new Date(item[key]).getHours();
                if (counts[hour] !== undefined) counts[hour]++;
            });

            return Object.entries(counts)
                .sort((a, b) => {
                    const hA = (parseInt(a[0]) - now.getHours() + 24) % 24;
                    const hB = (parseInt(b[0]) - now.getHours() + 24) % 24;
                    return hB - hA;
                })
                .map(entry => entry[1]);
        };

        return NextResponse.json({
            ok: true,
            version: 'v3-live-monitor',
            stats: {
                workingOrders: workingOrdersCount || 0,
                matchedCalls: matchedCallsCount || 0,
                transcribedCalls: transcribedCount || 0,
                pendingCalls: pendingCount || 0,
                trends: {
                    matches: groupStatsByHour(matchedTrend, 'matched_at'),
                    transcriptions: groupStatsByHour(transcribedTrend, 'started_at'),
                    evaluations: groupStatsByHour(evalTrend, 'eval_date')
                }
            }
        });

    } catch (e: any) {
        console.error('[SystemStats API] Error:', e);
        return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
    }
}
