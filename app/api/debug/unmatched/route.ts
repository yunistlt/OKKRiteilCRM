import { NextResponse } from 'next/server';
import { supabase } from '@/utils/supabase';

export const dynamic = 'force-dynamic';

export async function GET() {
    try {
        // 1. Get raw counts
        const { count: totalCalls } = await supabase.from('calls').select('*', { count: 'exact', head: true });
        const { count: totalMatches } = await supabase.from('matches').select('*', { count: 'exact', head: true });

        // 2. Identify UNMATCHED calls
        // Since we can't easily join-and-filter large datasets with just client, let's look at date ranges of matched vs unmatched.
        // Or simpler: Group calls by month and count how many matches in each month.

        // Get all call IDs that ARE matched
        const { data: matches } = await supabase.from('matches').select('call_id');
        const matchedCallIds = new Set((matches || []).map(m => m.call_id));

        // Fetch a sample of UNMATCHED calls to see their dates
        const { data: calls } = await supabase
            .from('calls')
            .select('id, timestamp, client_number, raw_data')
            .limit(1000); // Sample 1000 calls

        if (!calls) return NextResponse.json({ error: 'No calls found' });

        let unmatchedCountSample = 0;
        const unmatchedDates: string[] = [];

        calls.forEach(c => {
            if (!matchedCallIds.has(c.id)) {
                unmatchedCountSample++;
                unmatchedDates.push(c.timestamp);
            }
        });

        // Analyze date range of unmatched calls
        unmatchedDates.sort();
        const minUnmatched = unmatchedDates[0];
        const maxUnmatched = unmatchedDates[unmatchedDates.length - 1];

        // Also check Order availability for that range
        const { data: minOrder } = await supabase.from('orders')
            .select('created_at')
            .gte('created_at', minUnmatched || '2000-01-01')
            .lte('created_at', maxUnmatched || '2100-01-01')
            .order('created_at', { ascending: true })
            .limit(1);

        return NextResponse.json({
            stats: {
                total_calls: totalCalls,
                total_matches: totalMatches,
                match_rate_sample: `${Math.round(((1000 - unmatchedCountSample) / 1000) * 100)}%`
            },
            unmatched_sample: {
                count: unmatchedCountSample,
                earliest_call: minUnmatched,
                latest_call: maxUnmatched,
                sample_unmatched_ids: calls.filter(c => !matchedCallIds.has(c.id)).slice(0, 3).map(c => c.id)
            },
            data_availability: {
                do_we_have_orders_in_unmatched_range: !!minOrder,
                min_order_in_range: minOrder?.[0]?.created_at || 'None'
            }
        });

    } catch (error: any) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
