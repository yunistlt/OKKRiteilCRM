import { NextResponse } from 'next/server';
import { supabase } from '@/utils/supabase';

export const dynamic = 'force-dynamic';

export async function GET(
    request: Request,
    { params }: { params: { id: string } }
) {
    const orderId = parseInt(params.id);

    if (isNaN(orderId)) {
        return NextResponse.json({ error: 'Invalid Order ID' }, { status: 400 });
    }

    try {
        // Fetch calls matched to this order
        const { data: matches, error } = await supabase
            .from('call_order_matches')
            .select(`
                telphin_call_id,
                raw_telphin_calls (
                    telphin_call_id,
                    started_at,
                    duration_sec,
                    recording_url,
                    direction,
                    transcript,
                    from_username,
                    to_username,
                    from_number_normalized,
                    to_number_normalized
                )
            `)
            .eq('retailcrm_order_id', orderId)
            .order('raw_telphin_calls(started_at)', { ascending: false });

        if (error) throw error;

        const calls = (matches || [])
            .map((m: any) => m.raw_telphin_calls)
            .filter(Boolean);

        return NextResponse.json({ calls });
    } catch (e: any) {
        console.error('[API Calls] Error:', e);
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}
