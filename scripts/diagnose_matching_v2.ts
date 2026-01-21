
import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const supabase = createClient(supabaseUrl, supabaseKey);

async function run() {
    console.log('--- DIAGNOSTIC (SCHEMA CHECK) ---');

    const { data: matches, error } = await supabase
        .from('call_order_matches')
        .select('*')
        .limit(1);

    if (error) {
        console.error('Error fetching matches:', error);
        return;
    }

    if (!matches || matches.length === 0) {
        console.log('No matches found in table.');
        return;
    }

    console.log('Keys in call_order_matches:', Object.keys(matches[0]));
    console.log('Sample matched_at:', matches[0].matched_at);

    // Check recent matches by id/time
    const { data: recentMatches, error: recentError } = await supabase
        .from('call_order_matches')
        .select('matched_at, telphin_call_id')
        .order('matched_at', { ascending: false, nullsFirst: false })
        .limit(5);

    if (recentMatches) {
        console.log('Top 5 recent matches (by matched_at):');
        recentMatches.forEach(m => console.log(`  ${m.matched_at} (Call: ${m.telphin_call_id})`));
    }

}

run().catch(console.error);
