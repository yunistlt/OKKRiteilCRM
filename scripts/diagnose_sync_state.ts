
const { createClient } = require('@supabase/supabase-js');
const dotenv = require('dotenv');
dotenv.config({ path: '.env.local' });

// Hardcoded fallback from utils/supabase.ts if env is missing
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://lywtzgntmibdpgoijbty.supabase.co';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imx5d3R6Z250bWliZHBnb2lqYnR5Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2NzAzMzE4NSwiZXhwIjoyMDgyNjA5MTg1fQ.9jHVzGXQ8Rd2e4Bpe7tcWtq-hUCMvV9QaQSVsVZmPZw';

const supabase = createClient(supabaseUrl, supabaseKey);

async function diagnose() {
    console.log('--- DIAGNOSIS START ---');

    try {
        // 1. Check Sync State
        const { data: state, error: stateErr } = await supabase
            .from('sync_state')
            .select('*')
            .eq('key', 'retailcrm_last_sync_page');

        if (stateErr) console.error('Sync State Error:', stateErr);
        else console.log('Sync State:', state);

        // 2. Check Most Recent Order in DB
        const { data: recent, error: orderErr } = await supabase
            .from('orders')
            .select('id, number, created_at')
            .order('created_at', { ascending: false })
            .limit(5);


        if (orderErr) console.error('Orders Error:', orderErr);
        else {
            console.log('Recent Orders in DB IDs:', recent.map((r: any) => r.id));
            console.log('Recent Orders dates:', recent.map((r: any) => r.created_at));
        }

    } catch (e) {
        console.error('Script Error:', e);
    }
    console.log('--- DIAGNOSIS END ---');
}

diagnose();
