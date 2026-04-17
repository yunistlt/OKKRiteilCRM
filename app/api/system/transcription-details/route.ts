// @ts-nocheck
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
        // Fetch Min Duration Setting
        const { data: durationSetting } = await supabase
            .from('sync_state')
            .select('value')
            .eq('key', 'transcription_min_duration')
            .single();

        const minDuration = parseInt(durationSetting?.value || '15');

        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

        const baseSelect = `
                telphin_call_id,
                started_at,
                duration_sec,
                transcription_status,
                transcript,
                call_order_matches!inner (
                    orders!inner (
                        order_id,
                        number,
                        status,
                        totalsumm
                    )
                )
            `;

        // Fetch Queue (Ready)
        const { data: queue, error: e1 } = await supabase
            .from('raw_telphin_calls')
            .select(baseSelect)
            .in('call_order_matches.orders.status', transcribableCodes)
            .gte('started_at', thirtyDaysAgo.toISOString())
            .gte('duration_sec', minDuration) // Apply Min Duration Filter
            .in('transcription_status', ['pending', 'ready_for_transcription'])
            .order('started_at', { ascending: false })
            .limit(50);

        if (e1) throw e1;

        // Fetch Processing
        const { data: processing, error: e2 } = await supabase
            .from('raw_telphin_calls')
            .select(baseSelect)
            .in('call_order_matches.orders.status', transcribableCodes)
            .gte('started_at', thirtyDaysAgo.toISOString())
            .eq('transcription_status', 'processing')
            .order('started_at', { ascending: false })
            .limit(50);

        if (e2) throw e2;

        // Fetch Completed
        const { data: completed, error: e3 } = await supabase
            .from('raw_telphin_calls')
            .select(baseSelect)
            .in('call_order_matches.orders.status', transcribableCodes)
            .gte('started_at', thirtyDaysAgo.toISOString())
            .or('transcript.not.is.null,raw_payload->>transcript.not.is.null')
            .order('started_at', { ascending: false })
            .limit(50);

        if (e3) throw e3;

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
                transcription_status: c.transcription_status || null,
                transcript_preview: c.transcript ? c.transcript.substring(0, 50) + '...' : null
            };
        };

        return NextResponse.json({
            queue: (queue || []).map(formatCall),
            processing: (processing || []).map(formatCall),
            completed: (completed || []).map(formatCall)
        });

    } catch (e: any) {
        console.error('[TranscriptionDetails API] Error:', e);
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}
