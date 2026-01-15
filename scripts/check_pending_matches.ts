
import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const supabase = createClient(supabaseUrl, supabaseKey);

async function check() {
    console.log('--- Checking Matches for "soglasovanie-otmeny" ---');

    // 1. Get all pending orders
    const { data: orders, error } = await supabase
        .from('orders')
        .select('id, created_at, number')
        .eq('status', 'soglasovanie-otmeny');

    if (error) {
        console.error('Error fetching orders:', error);
        return;
    }

    if (!orders || orders.length === 0) {
        console.log('No orders in "soglasovanie-otmeny".');
        return;
    }

    console.log(`Found ${orders.length} orders in status "soglasovanie-otmeny".`);

    // 2. Get matches for these orders
    const orderIds = orders.map(o => o.id);
    const { data: matches, error: matchError } = await supabase
        .from('call_order_matches')
        .select('retailcrm_order_id')
        .in('retailcrm_order_id', orderIds);

    if (matchError) {
        console.error('Error fetching matches:', matchError);
        return;
    }

    const matchedOrderIds = new Set(matches?.map(m => m.retailcrm_order_id) || []);

    const missing = orders.filter(o => !matchedOrderIds.has(o.id));
    const covered = orders.length - missing.length;

    console.log(`\nResults:`);
    console.log(`✅ Covered: ${covered}`);
    console.log(`❌ Missing: ${missing.length}`);

    if (missing.length > 0) {
        console.log('\n--- Orders WITHOUT Matches ---');
        missing.forEach(o => {
            console.log(`#${o.id} (Date: ${o.created_at})`);
        });
    }
}

check();
