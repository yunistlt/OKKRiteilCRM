
import { supabase } from '../utils/supabase';

async function checkTranscription() {
    console.log('--- TRANSCRIPTION ANALYSIS ---');

    // 1. Last Cron Run
    const { data: syncState } = await supabase
        .from('sync_state')
        .select('*')
        .eq('key', 'transcription_last_run')
        .single();
    
    console.log('Last Cron Run:', syncState?.value || 'Never');

    // 2. Last Completed Transcription in raw_telphin_calls
    // We check for transcript being not null and non-empty
    const { data: lastTranscription } = await supabase
        .from('raw_telphin_calls')
        .select('event_id, started_at, transcription_status, transcript')
        .eq('transcription_status', 'completed')
        .order('started_at', { ascending: false })
        .limit(1)
        .single();

    if (lastTranscription) {
        console.log('Last Successful Transcription Call Date:', lastTranscription.started_at);
        console.log('Call Event ID:', lastTranscription.event_id);
    } else {
        console.log('No completed transcriptions found in raw_telphin_calls.');
    }

    // 3. Stats for last 24h
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { data: recentCalls } = await supabase
        .from('raw_telphin_calls')
        .select('transcription_status')
        .gte('started_at', twentyFourHoursAgo);

    const stats = {
        total: recentCalls?.length || 0,
        completed: recentCalls?.filter(c => c.transcription_status === 'completed').length || 0,
        pending: recentCalls?.filter(c => c.transcription_status === 'pending').length || 0,
        failed: recentCalls?.filter(c => c.transcription_status === 'failed' || c.transcription_status === 'error').length || 0,
        skipped: recentCalls?.filter(c => c.transcription_status === 'skipped').length || 0,
    };

    console.log('\n--- STATS (Last 24h) ---');
    console.log(JSON.stringify(stats, null, 2));

    // 4. Any recent errors?
    const { data: recentErrors } = await supabase
        .from('raw_telphin_calls')
        .select('event_id, started_at, transcription_status')
        .in('transcription_status', ['failed', 'error', 'skipped'])
        .order('started_at', { ascending: false })
        .limit(5);

    if (recentErrors && recentErrors.length > 0) {
        console.log('\n--- RECENT ERRORS/SKIPS ---');
        recentErrors.forEach(e => {
            console.log(`[${e.started_at}] ID: ${e.event_id} | Status: ${e.transcription_status}`);
        });
    }
}

checkTranscription().catch(console.error);
