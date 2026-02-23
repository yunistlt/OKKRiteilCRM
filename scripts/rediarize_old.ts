import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { supabase } from '../utils/supabase';
import { diarizeTranscript } from '../lib/transcribe';

async function main() {
    console.log('🔄 Starting re-diarization for old transcripts...');
    const start = Date.now();

    try {
        const { data: statuses } = await supabase.from('status_settings').select('code').eq('is_transcribable', true);
        const transcribableCodes = statuses?.map(s => s.code) || [];

        // 1. Fetch all completed transcripts in active statuses
        const { data: rows, error } = await supabase.from('raw_telphin_calls')
            .select('telphin_call_id, transcript, matches:call_order_matches!inner(orders:orders!inner(status))')
            .eq('transcription_status', 'completed')
            .not('transcript', 'is', null)
            .in('matches.orders.status', transcribableCodes);

        if (error) {
            console.error('Fetch error:', error);
            return;
        }

        // 2. Filter non-diarized ones
        const toProcess = rows?.filter(r =>
            !r.transcript.includes('Менеджер:') && !r.transcript.includes('Клиент:')
        ) || [];

        console.log(`📡 Found ${toProcess.length} transcripts needing diarization.`);

        let processed = 0;
        let errors = 0;

        for (const row of toProcess) {
            try {
                process.stdout.write(`🔹 [${processed + errors + 1}/${toProcess.length}] Rediarizing ${row.telphin_call_id}... `);

                const diarized = await diarizeTranscript(row.transcript);

                const { error: updateError } = await supabase.from('raw_telphin_calls')
                    .update({ transcript: diarized })
                    .eq('telphin_call_id', row.telphin_call_id);

                if (updateError) throw updateError;

                console.log('✅ Done');
                processed++;
            } catch (e) {
                console.log('❌ Failed');
                console.error(e);
                errors++;
            }

            // Moderate pace to avoid rate limits
            if (processed % 5 === 0) await new Promise(r => setTimeout(r, 800));
        }

        const duration = Math.round((Date.now() - start) / 1000);
        console.log('\n✨ Re-diarization complete!');
        console.log(`✅ Success: ${processed}`);
        console.log(`❌ Errors: ${errors}`);
        console.log(`⏱️ Duration: ${duration}s`);

    } catch (e) {
        console.error('💥 Fatal error:', e);
    }
}

main();
