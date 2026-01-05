
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { supabase } from '../utils/supabase';

// Helper: Get normalized 10 digits
const normalizePhone = (p: string | null | undefined): string | null => {
    if (!p) return null;
    const clean = p.replace(/[^\d]/g, '');
    if (clean.length === 0) return null;
    // Russian numbers: 11 digits starting with 7 or 8 -> strip first digit
    if (clean.length === 11 && (clean.startsWith('7') || clean.startsWith('8'))) {
        return clean.slice(1);
    }
    return clean;
};

async function inspect(callId: string) {
    console.log(`\n=== INSPECTING CALL: ${callId} ===`);

    const { data: call, error: callError } = await supabase.from('raw_telphin_calls').select('*').eq('telphin_call_id', callId).single();

    if (callError || !call) {
        console.error("Call not found:", callError);
        return;
    }

    console.log(`Call Time: ${call.started_at}`);
    console.log(`From: ${call.from_number} | To: ${call.to_number}`);

    const potentialNumbers = new Set<string>();

    // Add direct numbers
    [call.from_number, call.to_number].forEach(n => {
        const norm = normalizePhone(n);
        if (norm) {
            potentialNumbers.add(norm);
            console.log(`Normalized candidate: ${n} -> ${norm}`);
        }
    });

    if (potentialNumbers.size === 0) {
        console.log("No valid phone numbers found to search.");
        return;
    }

    // Generate search variations
    const searchPatterns = new Set<string>();
    potentialNumbers.forEach(p => {
        searchPatterns.add(p);      // 10 digit (e.g. 9854732695)
        searchPatterns.add(`7${p}`); // 7985...
        searchPatterns.add(`8${p}`); // 8985...
        searchPatterns.add(`+7${p}`);
    });

    const patterns = Array.from(searchPatterns);
    console.log("Searching for orders with phones overlapping:", patterns);

    const { data: foundOrders, error } = await supabase
        .from('orders')
        .select('order_id, number, created_at, customer_phones')
        .overlaps('customer_phones', patterns)
        .order('created_at', { ascending: false })
        .limit(10);

    if (error) {
        console.error("Search error:", error);
    } else {
        console.log(`Found ${foundOrders?.length} orders matching phone numbers.`);
        foundOrders?.forEach(o => {
            console.log(` - Order ${o.number} (ID: ${o.order_id}) | Created: ${o.created_at} | Phones: ${o.customer_phones}`);
        });
    }

    // Also verify if there are orders around that time period IGNORING phone
    const callTime = new Date(call.started_at);
    const startWindow = new Date(callTime.getTime() - 60 * 60 * 1000).toISOString(); // -1 hour
    const endWindow = new Date(callTime.getTime() + 60 * 60 * 1000).toISOString();   // +1 hour

    console.log(`\nChecking for any orders between ${startWindow} and ${endWindow}...`);
    const { data: nearbyOrders, error: countError } = await supabase
        .from('orders')
        .select('order_id, number, created_at, customer_phones')
        .gte('created_at', startWindow)
        .lte('created_at', endWindow);

    if (countError) {
        console.error("Error fetching orders:", countError);
    } else {
        console.log(`Found ${nearbyOrders?.length} orders in that 2-hour window.`);
        if (nearbyOrders?.length === 0) {
            console.warn("WARNING: No orders found around call time! Potential Sync Issue?");
        } else {
            console.log("Nearby orders details:");
            nearbyOrders?.forEach(o => {
                console.log(` - Order ${o.number} | Time: ${o.created_at} | Phones: ${JSON.stringify(o.customer_phones)}`);
            });
        }
    }

    // 1. Check if ANY order exists for this phone (global search)
    console.log(`\nChecking if phone appears in ANY order...`);
    const { data: globalOrders } = await supabase
        .from('orders')
        .select('order_id, number, created_at')
        .overlaps('customer_phones', patterns)
        .limit(5);

    if (globalOrders && globalOrders.length > 0) {
        console.log(`FOUND orders for this phone at other times:`);
        globalOrders.forEach(o => console.log(` - Order ${o.number} at ${o.created_at}`));
    } else {
        console.log("Phone NOT found in any order in the entire database.");
    }

    // 2. Check total orders for the day to verify sync health
    const dayStart = '2025-12-22T00:00:00+00:00';
    const dayEnd = '2025-12-22T23:59:59+00:00';
    const { count: dayCount } = await supabase
        .from('orders')
        .select('*', { count: 'exact', head: true })
        .gte('created_at', dayStart)
        .lte('created_at', dayEnd);

    console.log(`Total orders on 2025-12-22: ${dayCount}`);
}

inspect('858926-4BFA7A191C2D495FB123A28CDFFC0576').catch(console.error);
