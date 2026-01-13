import { NextResponse } from 'next/server';
import { supabase } from '@/utils/supabase';

export const dynamic = 'force-dynamic';

export async function GET() {
    try {
        const { data: transcribableSettings } = await supabase
            .from('status_settings')
            .select('code')
            .eq('is_transcribable', true);

        // Fetch Statuses for enrichment
        const { data: statusesData } = await supabase.from('statuses').select('code, name, color');
        const statusMap: Record<string, { name: string, color?: string }> = {};
        statusesData?.forEach((s: any) => {
            statusMap[s.code] = { name: s.name, color: s.color };
        });

        const transcribableCodes = (transcribableSettings || []).map(s => s.code);
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

        // Fetch Queue (Pending)
        const { data: pending, error: e1 } = await supabase
            .from('raw_telphin_calls')
            .select(`
                telphin_call_id,
                started_at,
                duration_sec,
                call_order_matches!inner (
                    orders!inner (
                        order_id,
                        number,
                        status,
                        totalsumm
                    )
                )
            `)
            .in('call_order_matches.orders.status', transcribableCodes)
            .gte('started_at', thirtyDaysAgo.toISOString())
            .is('transcript', null)
            .is('raw_payload->transcript', null)
            .order('started_at', { ascending: false })
            .limit(50);

        if (e1) throw e1;

        // Fetch Completed
        const { data: completed, error: e2 } = await supabase
            .from('raw_telphin_calls')
            .select(`
                telphin_call_id,
                started_at,
                duration_sec,
                transcript,
                call_order_matches!inner (
                    orders!inner (
                        order_id,
                        number,
                        status,
                        totalsumm
                    )
                )
            `)
            .in('call_order_matches.orders.status', transcribableCodes)
            .gte('started_at', thirtyDaysAgo.toISOString())
            .or('transcript.not.is.null,raw_payload->>transcript.not.is.null')
            .order('started_at', { ascending: false })
            .limit(50);

        if (e2) throw e2;

        const formatCall = (c: any) => {
            const order = c.call_order_matches?.[0]?.orders;
            const statusInfo = order ? statusMap[order.status] : null;

            return {
                id: c.telphin_call_id,
                date: c.started_at,
                duration: c.duration_sec,
                order: order ? {
                    ...order,
                    status_name: statusInfo?.name || order.status,
                    status_color: statusInfo?.color || '#333333'
                } : null,
                transcript_preview: c.transcript ? c.transcript.substring(0, 50) + '...' : null
            };
        };

        return NextResponse.json({
            queue: (pending || []).map(formatCall),
            completed: (completed || []).map(formatCall)
        });

    } catch (e: any) {
        console.error('[TranscriptionDetails API] Error:', e);
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}
