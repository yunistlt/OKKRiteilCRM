
import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const supabase = createClient(supabaseUrl, supabaseKey);

async function check() {
    console.log('--- Diagnosing Missing Matches ---');

    // 1. Get all pending orders
    const { data: orders, error } = await supabase
        .from('orders')
        .select('id, created_at, customer_phones, number')
        .eq('status', 'soglasovanie-otmeny');

    if (error || !orders) return;

    // 2. Get existing matches
    const { data: matches } = await supabase
        .from('call_order_matches')
        .select('retailcrm_order_id')
        .in('retailcrm_order_id', orders.map(o => o.id));

    const matchedIds = new Set(matches?.map(m => m.retailcrm_order_id));
    const missing = orders.filter(o => !matchedIds.has(o.id));

    console.log(`Missing Matches: ${missing.length}`);

    // 3. Inspect missing orders
    for (const order of missing) {
        console.log(`\nOrder #${order.id} (${order.created_at})`);
        const phones = order.customer_phones || [];
        console.log(`  Phones: ${JSON.stringify(phones)}`);

        if (!phones || phones.length === 0) {
            console.log('  ❌ NO PHONES');
            continue;
        }

        // Search for calls roughly around creation time (+/- 24h)
        const date = new Date(order.created_at);
        const nextDay = new Date(date); nextDay.setDate(date.getDate() + 1);
        const prevDay = new Date(date); prevDay.setDate(date.getDate() - 1);

        // Normalize phones for search (simple check)
        const searchTerms = phones.map((p: string) => p.replace(/\D/g, '').slice(-10)).filter((p: string) => p.length >= 10);

        if (searchTerms.length === 0) {
            console.log('  ❌ Invalid Phone Format');
            continue;
        }

        const { data: calls } = await supabase
            .from('raw_telphin_calls')
            .select('telphin_call_id, started_at, from_number, to_number')
            .gte('started_at', prevDay.toISOString())
            .lte('started_at', nextDay.toISOString())
            .or(searchTerms.map((t: string) => `from_number.ilike.%${t}%,to_number.ilike.%${t}%`).join(','))
            .limit(3);

        if (calls && calls.length > 0) {
            console.log(`  ✅ POTENTIAL CALLS FOUND (${calls.length}):`);
            calls.forEach(c => console.log(`    - ${c.started_at} (From: ${c.from_number})`));
        } else {
            console.log('  ⚠️ No calls found +/- 24h');
        }
    }
}

check();
