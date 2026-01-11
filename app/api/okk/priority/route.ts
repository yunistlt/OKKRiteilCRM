
import { NextResponse } from 'next/server';
import { supabase } from '@/utils/supabase';

export async function GET(request: Request) {
    try {
        const { searchParams } = new URL(request.url);
        const date = searchParams.get('date') || new Date().toISOString().split('T')[0];

        // 1. Fetch "Key for Today" orders
        // Note: Using text conversion ->> for customFields and exact string match
        const { data: orders, error: ordersError } = await supabase
            .from('orders')
            .select('*')
            .eq('raw_payload->customFields->>control', 'true')
            .eq('raw_payload->customFields->>data_kontakta', date);

        if (ordersError) throw ordersError;

        if (!orders || orders.length === 0) {
            return NextResponse.json({ orders: [] });
        }

        const enrichedOrders = await Promise.all(orders.map(async (order) => {
            const orderId = order.id;

            // 2. Fetch calls for today
            const startOfDay = `${date}T00:00:00Z`;
            const endOfDay = `${date}T23:59:59Z`;

            const { data: matchedCalls } = await supabase
                .from('call_order_matches')
                .select(`
                    telphin_call_id,
                    raw_telphin_calls (
                        transcript,
                        started_at,
                        duration_sec,
                        transcription_status
                    )
                `)
                .eq('retailcrm_order_id', orderId);

            const todayCalls = (matchedCalls || [])
                .map((m: any) => m.raw_telphin_calls)
                .filter((c: any) => c && c.started_at >= startOfDay && c.started_at <= endOfDay);

            // 3. Fetch emails/messages for today
            const { data: events } = await supabase
                .from('raw_order_events')
                .select('*')
                .eq('retailcrm_order_id', orderId)
                .gte('occurred_at', startOfDay)
                .lte('occurred_at', endOfDay);

            const outboundEvents = (events || []).filter((e: any) =>
                String(e.source).toLowerCase() === 'retailcrm' ||
                String(e.event_type).includes('manager_comment')
            );

            // 4. Calculate status
            let status: 'success' | 'in_progress' | 'fallback_required' | 'overdue' = 'in_progress';

            const hasDialogue = todayCalls.some((c: any) =>
                c.duration_sec > 15 && c.transcript && c.transcript.length > 50
            );

            const callCount = todayCalls.length;
            const hasEmail = outboundEvents.length > 0;

            if (hasDialogue) {
                status = 'success';
            } else if (callCount >= 3 && !hasEmail) {
                status = 'fallback_required';
            } else if (callCount >= 3 && hasEmail) {
                status = 'success'; // Fallback achieved
            }

            // Check if overdue (passed 14:00 local)
            // Note: For simplicity, we check against current time if date is today
            const now = new Date();
            const isToday = date === now.toISOString().split('T')[0];
            if (isToday && now.getHours() >= 14 && status !== 'success') {
                status = 'overdue';
            }

            return {
                ...order,
                today_stats: {
                    call_count: callCount,
                    has_dialogue: hasDialogue,
                    has_email: hasEmail,
                    status,
                    calls: todayCalls
                }
            };
        }));

        return NextResponse.json({ orders: enrichedOrders });
    } catch (error: any) {
        console.error('Error fetching priority orders:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
