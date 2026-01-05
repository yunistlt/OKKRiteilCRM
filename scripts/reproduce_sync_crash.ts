
const { createClient } = require('@supabase/supabase-js');
const dotenv = require('dotenv');
dotenv.config({ path: '.env.local' });

// Config
const RETAILCRM_URL = process.env.RETAILCRM_URL || process.env.RETAILCRM_BASE_URL || '';
const RETAILCRM_API_KEY = process.env.RETAILCRM_API_KEY || '';
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://lywtzgntmibdpgoijbty.supabase.co';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imx5d3R6Z250bWliZHBnb2lqYnR5Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2NzAzMzE4NSwiZXhwIjoyMDgyNjA5MTg1fQ.9jHVzGXQ8Rd2e4Bpe7tcWtq-hUCMvV9QaQSVsVZmPZw';

const supabase = createClient(supabaseUrl, supabaseKey);

// Helper
function cleanPhone(val: any) {
    if (!val) return '';
    return String(val).replace(/[^\d+]/g, '');
}

async function run() {
    console.log('--- REPRODUCTION STRING ---');

    if (!RETAILCRM_URL) { console.error('Missing URL'); return; }

    // 1. Get current page (IGNORED for Debug)
    let page = 1;
    console.log(`FORCING CHECK OF PAGE ${page} to verify Sort Order`);

    // 2. Fetch from CRM
    const baseUrl = RETAILCRM_URL.replace(/\/+$/, '');
    const limit = 100;
    const filterDateFrom = '2023-01-01 00:00:00';

    const params = new URLSearchParams();
    params.append('apiKey', RETAILCRM_API_KEY);
    params.append('limit', String(limit));
    params.append('page', String(page));
    params.append('filter[createdAtFrom]', filterDateFrom);
    params.append('paginator', 'page');

    const url = `${baseUrl}/api/v5/orders?${params.toString()}`;
    console.log(`Fetching: ${url}`);

    try {
        const res = await fetch(url);
        if (!res.ok) throw new Error(`API HTTP Error: ${res.status}`);

        const data = await res.json();
        if (!data.success) throw new Error(`API Success False: ${JSON.stringify(data)}`);

        const orders = data.orders || [];
        console.log(`Fetched ${orders.length} orders.`);
        console.log('Pagination:', data.pagination);

        const foundIds = orders.map((o: any) => o.id);
        if (foundIds.includes(50829)) {
            console.log('✅ ORDER 50829 FOUND IN LIST!');
        } else {
            console.log('❌ Order 50829 NOT found in list.');
            console.log('First 5 IDs:', foundIds.slice(0, 5));
            console.log('Last 5 IDs:', foundIds.slice(-5));
        }

        // Just check logic, no upset needed to verify sort order.
        // But let's upsert just in case we want to fix the data for the user.
        console.log('Skipping upsert for this debug run (read-only verification).');

    } catch (err) {
        console.error('❌ Crash:', err);
    }
}

run();
