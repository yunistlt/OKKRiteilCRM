
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { supabase } from '../utils/supabase';

async function run() {
    console.log('--- RAW TELPHIN TRANSCRIPTION STATS ---');

    const { count: completed } = await supabase
        .from('raw_telphin_calls')
        .select('*', { count: 'exact', head: true })
        .eq('transcription_status', 'completed');

    const { count: failed } = await supabase
        .from('raw_telphin_calls')
        .select('*', { count: 'exact', head: true })
        .eq('transcription_status', 'failed');

    const { count: pending } = await supabase
        .from('raw_telphin_calls')
        .select('*', { count: 'exact', head: true })
        .is('transcription_status', null)
        .not('recording_url', 'is', null);

    console.log(`Completed: ${completed}`);
    console.log(`Failed: ${failed}`);
    console.log(`Pending (with recording): ${pending}`);

    // Check durations of completed
    const { data: durs } = await supabase
        .from('raw_telphin_calls')
        .select('duration_sec')
        .eq('transcription_status', 'completed');

    if (durs) {
        const totalSec = durs.reduce((sum, d) => sum + (d.duration_sec || 0), 0);
        const totalMin = totalSec / 60;
        console.log(`Total duration: ${totalMin.toFixed(2)} minutes`);
        console.log(`Estimated cost ($0.006/min): $${(totalMin * 0.006).toFixed(2)}`);
    }
}
run();
