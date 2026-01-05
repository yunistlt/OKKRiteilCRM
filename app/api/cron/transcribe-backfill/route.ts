
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
            .limit(10); // Small batch for cron

        if (error) throw error;

        if (!candidates || candidates.length === 0) {
            // Maybe we are done? Or maybe just a gap. 
            // Let's check if there are ANY newer calls to decide if we should bump cursor blind?
            // For now, if 0, we just say "Up to date" relative to filter.
            // BUT, we must advance cursor to avoid getting stuck if calls exists but filtered out (e.g. short calls).
            // Actually, the current query filters in DB. So it finds the next VALID ones.
            // If 0 returned, it means no VALID calls after currentCursor.
            // We should find the max started_at in DB and set cursor to that?
            // Or better: Use a separate query to just "Advance Cursor" if no work found.

            // Strategy: If 0 candidates found, look for ANY call after cursor to advance it.
            const { data: nextCall } = await supabase
                .from('raw_telphin_calls')
                .select('started_at')
                .gt('started_at', currentCursor)
                .order('started_at', { ascending: true })
                .limit(1)
                .single();

            if (nextCall) {
                // Advance cursor to skip the "gap" of invalid calls
                await updateCursor(nextCall.started_at);
                return NextResponse.json({ message: 'Skipping gap of invalid/filtered calls', new_cursor: nextCall.started_at });
            }

            return NextResponse.json({ message: 'No more calls to backfill', cursor: currentCursor });
        }

        // 4. Process Batch
        const results = [];
        let lastTimestamp = currentCursor;

        for (const call of candidates) {
            try {
                await transcribeCall(call.event_id || call.telphin_call_id, call.recording_url);
                results.push({ id: call.telphin_call_id, status: 'success' });
            } catch (e: any) {
                console.error(`Backfill Error ${call.telphin_call_id}:`, e);
                results.push({ id: call.telphin_call_id, error: e.message });
            }
            lastTimestamp = call.started_at;
        }

        // 5. Update Cursor
        await updateCursor(lastTimestamp);

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
