
const { createClient } = require('@supabase/supabase-js');
const dotenv = require('dotenv');
dotenv.config({ path: '.env.local' });

// Supabase config
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://lywtzgntmibdpgoijbty.supabase.co';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imx5d3R6Z250bWliZHBnb2lqYnR5Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2NzAzMzE4NSwiZXhwIjoyMDgyNjA5MTg1fQ.9jHVzGXQ8Rd2e4Bpe7tcWtq-hUCMvV9QaQSVsVZmPZw';
const supabase = createClient(supabaseUrl, supabaseKey);

async function verify() {
    console.log('--- VERIFYING NEW SYNC LOGIC ---');

    // 1. Determine Start Date (Time-based sync)
    console.log('Step 1: Determine Start Date');
    let filterDateFrom = '2023-01-01 00:00:00';

    const { data: lastOrder } = await supabase
        .from('orders')
        .select('created_at')
        .order('created_at', { ascending: false })
        .limit(1)
        .single();

    if (lastOrder && lastOrder.created_at) {
        const d = new Date(lastOrder.created_at);
        d.setDate(d.getDate() - 1);
        filterDateFrom = d.toISOString().slice(0, 19).replace('T', ' ');
        console.log(`[Verify] Last Order: ${lastOrder.created_at}. Filter From: ${filterDateFrom}`);
    } else {
        console.log('[Verify] No recent orders. Filter From: 2023-01-01');
    }

    // 2. We expect this to be RECENT (2025/2026), so fetching from CRM should be quick.
    console.log('Step 2: Dry Run Fetch from RetailCRM');
    const RETAILCRM_URL = process.env.RETAILCRM_URL || process.env.RETAILCRM_BASE_URL || '';
    const RETAILCRM_API_KEY = process.env.RETAILCRM_API_KEY || '';
    const baseUrl = RETAILCRM_URL.replace(/\/+$/, '');

    let page = 1;
    let url = `${baseUrl}/api/v5/orders?apiKey=${RETAILCRM_API_KEY}&limit=100&page=${page}&filter[createdAtFrom]=${encodeURIComponent(filterDateFrom)}&paginator=page`;

    console.log(`[Verify] Fetching: ${url}`);
    const res = await fetch(url);
    const data = await res.json();

    if (data.success) {
        console.log(`[Verify] Success! Fetched ${data.orders.length} orders.`);
        const ids = data.orders.map((o: any) => o.id);

        if (ids.includes(50829)) {
            console.log('✅✅✅ ORDER 50829 IS IN THE FETCH LIST! FIX IS WORKING!');
        } else {
            console.log('⚠️ Order 50829 NOT in list. Check date range.');
            console.log('Found IDs:', ids.slice(0, 10));
        }
    } else {
        console.error('Fetch Failed:', data);
    }
}

verify();
