
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
dotenv.config();

import { processUnmatchedCalls } from '@/lib/call-matching';
import { supabase } from '@/utils/supabase';

async function runMatching() {
    console.log('--- Manual Matching Process ---');
    try {
        console.log('Fetching Unmatched Calls Count...');
        const { count, error } = await supabase
            .from('raw_telphin_calls')
            .select('*', { count: 'exact', head: true })
            .not('telphin_call_id', 'in', (
                supabase.from('call_order_matches').select('telphin_call_id')
            ));

        // Note: The subquery syntax above might not work exactly as is in all Supabase client versions
        // or simplistic SQL generation. A better check is finding calls without matches locally or just running processUnmatchedCalls.
        // Let's rely on processUnmatchedCalls logs.

        console.log('Running processUnmatchedCalls(100)...');
        const matches = await processUnmatchedCalls(100);
        console.log(`Matches created: ${matches}`);

    } catch (e: any) {
        console.error('Matching Failed:', e);
    }
}

runMatching();
