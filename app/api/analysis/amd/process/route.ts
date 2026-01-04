import { NextResponse } from 'next/server';
import { supabase } from '@/utils/supabase';
import { getTelphinToken } from '@/lib/telphin';
import { processCallTranscription } from '@/lib/transcription';

export const dynamic = 'force-dynamic';
export const maxDuration = 300; // Allow long execution for batching

export async function GET(request: Request) {
    try {
        const { searchParams } = new URL(request.url);
        const limit = parseInt(searchParams.get('limit') || '5');
        const minDuration = parseInt(searchParams.get('minDuration') || '15');

        // 0. Fetch Working Statuses
        const { data: workingSettings } = await supabase.from('status_settings').select('code').eq('is_working', true);
        const workingCodes = new Set((workingSettings || []).map(s => s.code));

        // 1. Get unprocessed calls that are suspicious and matched to working orders
        // Refactored to use RAW layer
        const { data: calls, error: fetchError } = await supabase
            .from('raw_telphin_calls')
            .select(`
                telphin_call_id, 
                recording_url, 
                duration_sec,
                raw_payload,
                call_order_matches!inner (
                    orders!inner (
                        status
                    )
                )
            `)
            .is('raw_payload->transcript', null)
            .matcher(`(recording_url.neq.null,raw_payload->>storage_url.neq.null)`) // Ensure we have a URL (complex filter might need modification, doing simplistic check or filter in code)
            // supabase-js simple filter: .not('recording_url', 'is', null) - but it might be in payload.
            // Let's just fetch recent ones and filter in code for safety if URL is tricky.
            // Actually, let's just check raw_payload->>storage_url for new items.
            .not('raw_payload', 'is', null)
            .gt('duration_sec', minDuration)
            .in('call_order_matches.orders.status', Array.from(workingCodes))
            .order('started_at', { ascending: false })
            .limit(limit);

        if (fetchError) throw fetchError;

        const callsToProcess = (calls || []).filter(c => {
            const payload = c.raw_payload as any;
            const url = c.recording_url || payload?.recording_url || payload?.record_url || payload?.storage_url || payload?.url;
            return !!url;
        });

        if (callsToProcess.length === 0) {
            return NextResponse.json({ message: 'No calls to process', count: 0 });
        }

        // 2. Get Telphin Token
        const token = await getTelphinToken();

        // 3. Process sequentially
        const results = [];
        for (const call of callsToProcess) {
            const payload = call.raw_payload as any;
            const url = call.recording_url || payload?.recording_url || payload?.record_url || payload?.storage_url || payload?.url;

            const result = await processCallTranscription(call.telphin_call_id, url, token);
            results.push({
                id: call.telphin_call_id,
                duration: call.duration_sec,
                ...result
            });
        }

        return NextResponse.json({
            success: true,
            processed: results.length,
            details: results
        });

    } catch (e: any) {
        console.error('[AMD API] Error:', e);
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}
