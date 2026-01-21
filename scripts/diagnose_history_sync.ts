
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';

// Load env explicitly
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const RETAILCRM_URL = process.env.RETAILCRM_URL;
const RETAILCRM_API_KEY = process.env.RETAILCRM_API_KEY;

if (!supabaseUrl || !supabaseKey || !RETAILCRM_URL || !RETAILCRM_API_KEY) {
    console.error('Missing env vars');
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function diagnoseHistory() {
    console.log('--- DIAGNOSE HISTORY SYNC ---');

    // 1. Check last event time
    const { data: lastEntry, error } = await supabase
        .from('raw_order_events')
        .select('occurred_at')
        .order('occurred_at', { ascending: false })
        .limit(1)
        .single();

    if (error) {
        console.error('Error fetching last event:', error);
    } else {
        console.log(`Last Event in DB: ${lastEntry?.occurred_at || 'NONE'}`);
    }

    // 2. Try fetching 1 page from CRM history to see if API works
    const now = new Date();
    const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
    const formattedDate = oneDayAgo.slice(0, 19).replace('T', ' ');

    const url = `${RETAILCRM_URL}/api/v5/orders/history?apiKey=${RETAILCRM_API_KEY}&filter[startDate]=${encodeURIComponent(formattedDate)}&page=1&limit=20`;
    console.log(`\nTesting CRM API: ${url.replace(RETAILCRM_API_KEY, '***')}`);

    try {
        const res = await fetch(url);
        const data = await res.json();

        if (data.success) {
            console.log(`API Success. Found ${data.history?.length || 0} events/changes in last 24h.`);
            if (data.history && data.history.length > 0) {
                console.log('Sample event:', JSON.stringify(data.history[0], null, 2).slice(0, 200) + '...');
            }
        } else {
            console.error('API Failed:', data);
        }
    } catch (e: any) {
        console.error('Network Error:', e.message);
    }
}

diagnoseHistory();
