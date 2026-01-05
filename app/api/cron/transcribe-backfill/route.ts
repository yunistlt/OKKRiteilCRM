
import { NextResponse } from 'next/server';
import { supabase } from '@/utils/supabase';
import { transcribeCall } from '@/lib/transcribe';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
    try {
        console.log('[Cron] Starting Transcription Backfill...');

        // 1. Load Settings
        const { data: settings } = await supabase
            .from('sync_state')
            .select('key, value')
            .in('key', ['transcription_backfill_cursor', 'transcription_min_duration']);

        const stateMap = new Map(settings?.map(s => [s.key, s.value]));

        // Default cursor: Start of "Modern Era" (Sept 1, 2025)
        const START_CURSOR = '2025-09-01T00:00:00+00:00';
        let currentCursor = stateMap.get('transcription_backfill_cursor') || START_CURSOR;
        const minDuration = parseInt(stateMap.get('transcription_min_duration') || '15');

        // Validation: If cursor is weird or future, reset? No, trust DB.

        // 2. Load Working Statuses
        const { data: statusData } = await supabase
            .from('status_settings')
            .select('code')
            .eq('is_working', true);

        const workingCodes = (statusData || []).map(s => s.code);

        if (workingCodes.length === 0) {
            return NextResponse.json({ message: 'No working statuses defined' });
        }

        // 3. Fetch Batch (Next 20 items after cursor)
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
            .gt('started_at', currentCursor)
            .is('raw_payload->transcript', null) // Only untranscribed
            .gt('duration_sec', minDuration)
            .in('call_order_matches.orders.status', workingCodes)
            .not('recording_url', 'is', null)
            .order('started_at', { ascending: true }) // Oldest first (progressing forward)
            .limit(3); // Small batch to prevent Vercel Timeout (Sync is slow!)

        if (error) throw error;

        if (!candidates || candidates.length === 0) {
            // Find the *latest* call time in DB to see if we are caught up
            const { data: lastRaw } = await supabase
                .from('raw_telphin_calls')
                .select('started_at')
                .order('started_at', { ascending: false })
                .limit(1)
                .single();

            // If we have data and we found no candidates, it implies we are caught up relative to filter.
            // We should update cursor to "Latest Raw Time" (or Now) so status says "Fresh".
            if (lastRaw) {
                await updateCursor(lastRaw.started_at);
                return NextResponse.json({ message: 'Caught up (No valid candidates found)', cursor: lastRaw.started_at });
            }

            return NextResponse.json({ message: 'No calls found at all', cursor: currentCursor });
        }

        // 4. Process Batch
        const results = [];

        for (const call of candidates) {
            try {
                // Transcribe
                await transcribeCall(call.event_id || call.telphin_call_id, call.recording_url);
                results.push({ id: call.telphin_call_id, status: 'success' });

                // CRITICAL: Update Cursor IMMEDIATELY after each success.
                // This ensures if Vercel times out on the next call, we don't lose progress.
                await updateCursor(call.started_at);

            } catch (e: any) {
                console.error(`Backfill Error ${call.telphin_call_id}:`, e);
                results.push({ id: call.telphin_call_id, error: e.message });
                // If error, we might want to skip this call in future?
                // For now, we update cursor past it? No, if we update cursor, we skip retry.
                // Let's NOT update cursor on failure, so it retries next time?
                // Risk: Infinite loop on broken file.
                // Improvement: Log error and Update Cursor anyway (skip bad file).
                await updateCursor(call.started_at);
            }
        }

        return NextResponse.json({
            processed: results.length,
            new_cursor: lastTimestamp,
            details: results
        });

    } catch (e: any) {
        console.error('Backfill Cron Error:', e);
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}

async function updateCursor(timestamp: string) {
    await supabase.from('sync_state').upsert({
        key: 'transcription_backfill_cursor',
        value: timestamp,
        updated_at: new Date().toISOString()
    }, { onConflict: 'key' });
}
