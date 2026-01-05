
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { supabase } from '../utils/supabase';

async function run() {
    console.log('--- FETCHING RECENT SAMPLES ---');

    // 1. Get 10 most recent call IDs that have transcripts
    const { data: recent, error } = await supabase
        .from('raw_telphin_calls')
        .select('telphin_call_id, started_at, transcript, duration_sec')
        .not('transcript', 'is', null)
        .order('started_at', { ascending: false })
        .limit(3);

    if (error) {
        console.error('Error:', error);
        return;
    }

    if (!recent || recent.length === 0) {
        console.log('No transcripts found.');
        return;
    }

    recent.forEach((r, i) => {
        console.log(`\n--- SAMPLE #${i + 1} ---`);
        console.log(`Date: ${r.started_at}`);
        console.log(`Duration: ${r.duration_sec} sec`);
        console.log(`Transcript:`);
        console.log(r.transcript?.substring(0, 1000));
        console.log('------------------');
    });
}
run();
