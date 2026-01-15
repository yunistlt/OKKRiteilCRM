import { NextResponse } from 'next/server';
import { supabase } from '@/utils/supabase';

export const dynamic = 'force-dynamic';

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;

    if (!id) {
        return NextResponse.json({ error: 'Order ID required' }, { status: 400 });
    }

    try {
        // 1. Fetch Order Details (Basic info)
        const { data: order, error: orderError } = await supabase
            .from('orders')
            .select(`
                *,
                managers ( first_name, last_name, email )
            `)
            .eq('order_id', id)
            .single();

        if (orderError) throw orderError;

        // 2. Fetch Call Transcriptions (via raw_telphin_calls and matches)
        // We join call_order_matches -> raw_telphin_calls -> call_transcriptions
        // Since Supabase joins can be tricky with multiple levels, we'll do it in steps or use a View if it existed.
        // Step A: Get matched call IDs
        const { data: matches } = await supabase
            .from('call_order_matches')
            .select('call_id, match_score, match_type')
            .eq('order_id', id)
            .order('created_at', { ascending: false });

        const callIds = matches?.map(m => m.call_id) || [];

        let calls: any[] = [];
        if (callIds.length > 0) {
            // Step B: Fetch calls and their transcriptions
            const { data: callsData } = await supabase
                .from('raw_telphin_calls')
                .select(`
                    *,
                    call_transcriptions ( transcription_text, summary, sentiment )
                `)
                .in('telphin_call_id', callIds)
                .order('started_at', { ascending: false });

            calls = callsData || [];
        }

        // 3. Fetch Communications (Emails, Messages from raw_order_events)
        const { data: events } = await supabase
            .from('raw_order_events')
            .select('event_type, raw_payload, occurred_at')
            .eq('retailcrm_order_id', order.order_id) // Match by RetailCRM ID (which is order_id in orders table usually, or we match via FK if needed. Let's assume order_id is correct)
            .or('event_type.ilike.%email%,event_type.ilike.%message%,event_type.ilike.%comment%')
            .order('occurred_at', { ascending: false })
            .limit(10);

        // Normalize events for frontend
        const emails = events?.map(e => ({
            id: e.occurred_at, // use timestamp as id
            date: e.occurred_at,
            type: e.event_type,
            text: e.raw_payload?.text || e.raw_payload?.message || e.raw_payload?.newValue || JSON.stringify(e.raw_payload),
            source: e.raw_payload?.source || 'unknown'
        })) || [];

        // Return structured data
        return NextResponse.json({
            order: {
                ...order,
                manager_name: order.managers ? `${order.managers.first_name || ''} ${order.managers.last_name || ''}`.trim() : 'Не определен'
            },
            calls: calls.map(c => ({
                id: c.telphin_call_id,
                date: c.started_at,
                type: c.direction,
                duration: c.duration_sec,
                transcription: c.call_transcriptions?.[0]?.transcription_text || null,
                summary: c.call_transcriptions?.[0]?.summary || null,
                link: c.recording_url
            })),
            emails: emails,
            raw_payload: order.raw_payload // Contains manager comments and history from RetailCRM if synced full
        });

    } catch (e: any) {
        console.error('Order Details Error:', e);
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}
