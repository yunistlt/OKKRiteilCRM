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
        const { data: calls, error: fetchError } = await supabase
            .from('calls')
            .select(`
                id, 
                record_url, 
                duration,
                call_order_matches!inner (
                    orders!inner (
                        status
                    )
                )
            `)
            .is('transcript', null)
            .not('record_url', 'is', null)
            .gt('duration', minDuration)
            .in('call_order_matches.orders.status', Array.from(workingCodes))
            .order('timestamp', { ascending: false })
            .limit(limit);

        if (fetchError) throw fetchError;

        if (!calls || calls.length === 0) {
            return NextResponse.json({ message: 'No calls to process', count: 0 });
        }

        // 2. Get Telphin Token
        const token = await getTelphinToken();

        // 3. Process sequentially (to avoid OpenAI rate limits or too many downloads)
        const results = [];
        for (const call of calls) {
            const result = await processCallTranscription(call.id, call.record_url!, token);
            results.push({
                id: call.id,
                duration: call.duration,
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
