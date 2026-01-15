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

        // 3. Fetch Status History (Violations table often acts as a history log for rules, 
        // but for exact status changes we might rely on RetailCRM audit if we synced it.
        // For now, we'll return recent violations as "History of Issues" and rely on raw_payload for current state)

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
            raw_payload: order.raw_payload // Contains manager comments and history from RetailCRM if synced full
        });

    } catch (e: any) {
        console.error('Order Details Error:', e);
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}
