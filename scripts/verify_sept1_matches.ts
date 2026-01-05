
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { supabase } from '../utils/supabase';

function normalizePhone(val: any) {
    if (!val) return null;
    let s = String(val).replace(/[^\d]/g, '');
    if (s.length === 11 && (s.startsWith('7') || s.startsWith('8'))) {
        s = s.slice(1);
    }
    return s.length >= 10 ? s : null;
}

async function verifySept1() {
    console.log('=== VERIFYING MATCHES FOR SEPT 1, 2025 ===');

    const start = '2025-09-01T00:00:00+00:00';
    const end = '2025-09-01T23:59:59+00:00';

    // 1. Fetch Calls
    console.log('Fetching calls...');
    const { data: calls, error: callErr } = await supabase
        .from('raw_telphin_calls')
        .select('*')
        .gte('started_at', start)
        .lte('started_at', end);

    if (callErr) { console.error('Call fetch error:', callErr); return; }
    console.log(`Found ${calls?.length} calls.`);

    // 2. Fetch Orders
    console.log('Fetching orders...');
    // Note: Orders might be matched by created_at OR any update time, but let's assume created_at for "events"
    const { data: orders, error: orderErr } = await supabase
        .from('orders')
        .select('*')
        .gte('created_at', start)
        .lte('created_at', end);

    if (orderErr) { console.error('Order fetch error:', orderErr); return; }
    console.log(`Found ${orders?.length} orders.`);

    if (!calls?.length || !orders?.length) {
        console.log("⚠️ Missing data for comparison. Cannot match.");
        return;
    }

    // 3. Normalize Order Phones
    const orderMap = new Map<string, any[]>();
    let totalOrderPhones = 0;

    orders.forEach(o => {
        if (Array.isArray(o.customer_phones)) {
            o.customer_phones.forEach((p: string) => {
                const norm = normalizePhone(p);
                if (norm) {
                    if (!orderMap.has(norm)) orderMap.set(norm, []);
                    orderMap.get(norm)?.push(o);
                    totalOrderPhones++;
                    // Debug Log first 3
                    if (totalOrderPhones <= 3) console.log(`[DEBUG] Order Phone: ${p} -> Norm: ${norm}`);
                }
            });
        }
    });

    // 4. Simulate
    // Log sample call phones
    console.log('\n[DEBUG] Sample Call Phones:');
    calls.slice(0, 3).forEach(c => {
        console.log(`Call ID ${c.telphin_call_id}: From=${c.from_number} (${c.from_number_normalized}), To=${c.to_number} (${c.to_number_normalized})`);
    });
    let matchesFound = 0;
    let alreadyLinked = 0;

    for (const call of calls) {
        // We check both from and to numbers
        // Usually matching is done on the client's number (passed as 'from' in incoming, 'to' in outgoing)
        // But for safety let's check both normalized
        const cNorms = [call.from_number_normalized, call.to_number_normalized].filter(Boolean);

        // Find candidate orders
        const candidates = new Set<string>();
        cNorms.forEach(n => {
            if (n && orderMap.has(n)) {
                orderMap.get(n)?.forEach(o => candidates.add(o.order_id || o.id));
            }
        });

        if (candidates.size > 0) {
            matchesFound++;
            // Check if actually linked in DB
            // Typically this would be in a 'call_matches' or 'link' table, or a field on the call?
            // Assuming 'call_matches' exists or we check 'calls' table 'order_id' field?
            // "почему нет в таблице матчей" implies a separate table or field.
            // Let's assume we check if this call ID exists in 'call_orders_match' or similar if known.
            // Or just logging for now since I don't recall the exact match table name (maybe 'matched_orders'?)

            // Let's check typical table 'call_matches' or similar manually in next step if this finds plenty.
            console.log(`Call ${call.telphin_call_id} (${call.direction}) matches Order(s): ${Array.from(candidates).join(', ')}`);
        }
    }

    console.log(`\nSimulation Result:`);
    console.log(`Total Calls: ${calls.length}`);
    console.log(`Matched (Simulated): ${matchesFound}`);
    console.log(`Match Rate: ${((matchesFound / calls.length) * 100).toFixed(1)}%`);
}

verifySept1().catch(console.error);
