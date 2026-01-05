
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { supabase } from '../utils/supabase';

async function run() {
    console.log('--- ANALYZING MATCH ID PATTERNS ---');

    const { data: matches, error } = await supabase
        .from('call_order_matches')
        .select('telphin_call_id')
        .limit(100);

    if (error) {
        console.error('Error:', error);
        return;
    }

    let prefixed = 0;
    let clean = 0;

    matches.forEach(m => {
        if (m.telphin_call_id.includes('-')) prefixed++;
        else clean++;
    });

    console.log(`Prefixed IDs: ${prefixed}`);
    console.log(`Clean IDs: ${clean}`);

    if (matches.length > 0) {
        console.log('Sample IDs:', matches.slice(0, 5).map(m => m.telphin_call_id));
    }
}
run();
