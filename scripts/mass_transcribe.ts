import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { supabase } from '../utils/supabase';
import { transcribeCall, isTranscribable } from '../lib/transcribe';

async function main() {
    console.log('🎙️ Starting mass transcription for all pending calls...');
    const start = Date.now();

    try {
        // 1. Fetch Transcribable Statuses
        const { data: statusSettings } = await supabase
            .from('status_settings')
            .select('code')
            .eq('is_transcribable', true);

        const transcribableStatuses = statusSettings?.map(s => s.code) || [];

        if (transcribableStatuses.length === 0) {
            console.log('⚠️ No statuses configured for transcription.');
            return;
        }

        // 2. Fetch Candidates
        const { data: calls, error } = await supabase
            .from('raw_telphin_calls')
            .select(`
                *,
                matches:call_order_matches!inner(
                    retailcrm_order_id,
                    orders:orders!inner(status)
                )
            `)
            .eq('transcription_status', 'pending')
            .not('recording_url', 'is', null)
            .in('matches.orders.status', transcribableStatuses)
            .order('started_at', { ascending: false });

        if (error) {
            console.error('Fetch error:', error);
            return;
        }

        if (!calls || calls.length === 0) {
            console.log('✅ No pending transcribable calls found.');
            return;
        }

        console.log(`📡 Found ${calls.length} calls to transcribe.`);

        let processed = 0;
        let errors = 0;
        let skipped = 0;

        for (const call of calls) {
            const callId = call.telphin_call_id || call.event_id?.toString();

            if (!isTranscribable(call)) {
                console.log(`⏩ Skipping call ${callId} (Not transcribable)`);
                await supabase
                    .from('raw_telphin_calls')
                    .update({ transcription_status: 'skipped' })
                    .eq('telphin_call_id', call.telphin_call_id);
                skipped++;
                continue;
            }

            try {
                console.log(`🔹 [${processed + errors + skipped + 1}/${calls.length}] Transcribing ${callId}...`);
                await transcribeCall(callId, call.recording_url);
                processed++;
            } catch (e) {
                console.error(`❌ Error transcribing ${callId}:`, e);
                errors++;
            }

            // Small delay to avoid hitting rate limits too fast
            if (processed % 3 === 0) await new Promise(r => setTimeout(r, 500));
        }

        const duration = Math.round((Date.now() - start) / 1000);
        console.log('\n✨ Mass transcription complete!');
        console.log(`📊 Total: ${calls.length}`);
        console.log(`✅ Success: ${processed}`);
        console.log(`⏩ Skipped: ${skipped}`);
        console.log(`❌ Errors: ${errors}`);
        console.log(`⏱️ Duration: ${duration}s`);

    } catch (e) {
        console.error('💥 Fatal error:', e);
    }
}

main();
