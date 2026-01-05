
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
require('tsconfig-paths/register');

import { supabase } from '../utils/supabase';
import { transcribeCall } from '../lib/transcribe';

async function runTranscriptionBackfill() {
    console.log('=== HISTORICAL TRANSCRIPTION WORKER ===');
    console.log('Filters: Dynamic Duration (default 15s), Linked to Working Order, Human Voice');

    // 1a. Get Min Duration Setting
    const { data: durationSetting } = await supabase
        .from('sync_state')
        .select('value')
        .eq('key', 'transcription_min_duration')
        .single();

    const minDuration = parseInt(durationSetting?.value || '15');
    console.log(`Using Min Duration: ${minDuration}s`);

    // 1b. Get Working Statuses
    const { data: settings } = await supabase
        .from('status_settings')
        .select('code')
        .eq('is_working', true);

    const workingCodes = (settings || []).map(s => s.code);
    console.log(`Loaded ${workingCodes.length} working statuses:`, workingCodes.join(', '));

    if (workingCodes.length === 0) {
        console.error('No working statuses found! Aborting.');
        return;
    }

    // 2. Loop Setup
    const START_DATE = '2025-09-01T00:00:00+00:00';
    const END_DATE = new Date().toISOString();
    const BATCH_SIZE = 50;

    let hasMore = true;
    let offset = 0;
    let processedCount = 0;
    let transcribedCount = 0;

    console.log(`Starting scan from ${START_DATE}...`);

    while (hasMore) {
        // Fetch batch of raw calls
        // We need to join with call_order_matches -> orders to check status

        const { data: candidates, error } = await supabase
            .from('raw_telphin_calls')
            .select(`
                telphin_call_id,
                event_id,
                duration_sec,
                recording_url,
                started_at,
                transcription_status,
                raw_payload,
                call_order_matches!inner (
                    orders!inner (
                        status
                    )
                )
           `)
            .gte('started_at', START_DATE)
            .lte('started_at', END_DATE)
            .is('raw_payload->transcript', null) // Only untranscribed
            .gt('duration_sec', minDuration) // Filter 1: Duration
            .in('call_order_matches.orders.status', workingCodes) // Filter 2: Working Status
            .not('recording_url', 'is', null) // Must have audio
            .order('started_at', { ascending: true })
            .range(offset, offset + BATCH_SIZE - 1);

        if (error) {
            console.error('Fetch error:', error);
            // If range error, break
            break;
        }

        if (!candidates || candidates.length === 0) {
            console.log(`No candidates found in range ${offset}-${offset + BATCH_SIZE}. Checking next batch...`);
            hasMore = false;
            break;
        }

        console.log(`[Batch ${offset}] Found ${candidates.length} candidates.`);

        for (const call of candidates) {
            console.log(`Processing call ${call.telphin_call_id} (${call.duration_sec}s)...`);

            try {
                // Call Library function
                await transcribeCall(call.event_id || call.telphin_call_id, call.recording_url);
                transcribedCount++;

                // Sleep to be nice to APIs
                await new Promise(r => setTimeout(r, 2000));

            } catch (e: any) {
                console.error(`Failed to transcribe ${call.telphin_call_id}:`, e.message);
            }
        }

        offset += BATCH_SIZE;
        processedCount += candidates.length;

        console.log(`Progress: Scanned ${processedCount}, Transcribed ${transcribedCount}`);

        // Optional: Pause between batches
        await new Promise(r => setTimeout(r, 1000));
    }

    console.log('Backfill Complete.');
}

runTranscriptionBackfill().catch(console.error);
