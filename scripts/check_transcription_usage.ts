
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { supabase } from '../utils/supabase';

async function run() {
    console.log('--- TRANSCRIPTION USAGE CHECK ---');

    // Check calls table for transcriptions added today (ingested_at might not be the right column, let's look for transcript presence)
    // Actually we don't have a 'transcribed_at' column in 'calls' probably. 
    // Let's check 'raw_telphin_calls' if it has anything.
    // Or just look at the 'calls' table last 100 rows and count those with transcript.

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Since we don't have 'transcribed_at', let's just count total with transcript
    const { count: totalTranscribed } = await supabase
        .from('calls')
        .select('*', { count: 'exact', head: true })
        .not('transcript', 'is', null);

    console.log(`Total calls with transcript: ${totalTranscribed}`);

    // Look at recent transcripts
    const { data: recent } = await supabase
        .from('calls')
        .select('id, timestamp, transcript')
        .not('transcript', 'is', null)
        .order('timestamp', { ascending: false })
        .limit(20);

    console.log('Recent Transcriptions (timestamps):');
    recent?.forEach(r => {
        console.log(`ID: ${r.id}, Call Time: ${r.timestamp}`);
    });
}
run();
