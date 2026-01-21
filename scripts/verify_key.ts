
import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

// Hardcoded key from utils/supabase.ts
const hardcodedKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imx5d3R6Z250bWliZHBnb2lqYnR5Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2NzAzMzE4NSwiZXhwIjoyMDgyNjA5MTg1fQ.9jHVzGXQ8Rd2e4Bpe7tcWtq-hUCMvV9QaQSVsVZmPZw';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://lywtzgntmibdpgoijbty.supabase.co';

console.log('Testing Hardcoded Key...');
const supabase = createClient(supabaseUrl, hardcodedKey);

async function run() {
    const { data, error } = await supabase.from('call_order_matches').select('*').limit(1);

    if (error) {
        console.error('Hardcoded Key FAILED:', error.message);
    } else {
        console.log('Hardcoded Key SUCCESS! Found matches:', data?.length);
    }
}

run();
