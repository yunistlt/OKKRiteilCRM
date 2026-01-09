
import { NextResponse } from 'next/server';
import { supabase } from '@/utils/supabase';
import { transcribeCall } from '@/lib/transcribe';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
    // EMERGENCY DISABLE: This endpoint is consuming too much OpenAI credits
    // It has been removed from vercel.json but Vercel cron cache still triggers it
    console.log('[Backfill] Endpoint disabled to prevent costs');
    return NextResponse.json({
        ok: false,
        message: 'This endpoint has been permanently disabled to reduce OpenAI costs. Use /api/cron/transcribe instead.'
    });

// Original code below (disabled)
/*
try {
    console.log('[Cron] Starting Dynamic Transcription Sync...');

    // 1. Load Settings
    const { data: settings } = await supabase
        .from('sync_state')
        .select('key, value')
        .eq('key', 'transcription_min_duration')
        .single();

    const minDuration = parseInt(settings?.value || '15');

    // 2. Load Transcribable Statuses
    const { data: statusData } = await supabase
        .from('status_settings')
        .select('code')
        .eq('is_transcribable', true);

    const transcribableCodes = (statusData || []).map(s => s.code);

    if (transcribableCodes.length === 0) {
        return NextResponse.json({ message: 'No transcribable statuses defined' });
    }

    // 3. Fetch Batch (Calls missing transcript in transcribable statuses)
    // We exclude 'failed' status to avoid infinite retry loops on broken files, 
    // but we might want to retry occasionally. For now, just 'null' or 'pending'.
    const { data: candidates, error } = await supabase
        .from('raw_telphin_calls')
        .select(`
            telphin_call_id,
            event_id,
            duration_sec,
            recording_url,
            started_at,
            call_order_matches!inner (
                orders!inner (
                    status
                )
            )
        `)
        .is('transcript', null) // Missing transcript
        .is('raw_payload->transcript', null)
        .neq('transcription_status', 'failed') // Skip known bad hangups/errors
        .gt('duration_sec', minDuration)
        .in('call_order_matches.orders.status', transcribableCodes)
        .not('recording_url', 'is', null)
        .order('started_at', { ascending: false }) // Newest first for better UX
        .limit(3);

    if (error) throw error;

    if (!candidates || candidates.length === 0) {
        return NextResponse.json({ message: 'Queue empty' });
    }

    // 4. Process Batch
    const results = [];
    for (const call of candidates) {
        try {
            await transcribeCall(call.event_id || call.telphin_call_id, call.recording_url);
            results.push({ id: call.telphin_call_id, status: 'success' });
        } catch (e: any) {
            console.error(`Transcription Error ${call.telphin_call_id}:`, e);
            results.push({ id: call.telphin_call_id, error: e.message });
        }
    }

    return NextResponse.json({
        processed: results.length,
        details: results
    });

} catch (e: any) {
    console.error('Transcription Cron Error:', e);
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
    }
}
*/
