
import { supabase } from '../utils/supabase';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

async function findTestOrder() {
    console.log('🔍 Looking for an order with matched calls to test Triple Check...');

    // Find orders with matches
    const { data: matches, error } = await supabase
        .from('call_order_matches')
        .select(`
            retailcrm_order_id,
            telphin_call_id,
            raw_telphin_calls (
                event_id,
                direction,
                duration_sec,
                transcript
            )
        `)
        .limit(10);

    if (error) {
        console.error('❌ DB Error:', error);
        return;
    }

    if (!matches || matches.length === 0) {
        console.log('⚠️ No orders found with matched calls. Testing with a random order instead.');
        return;
    }

    console.log(`✅ Found ${matches.length} matches. Picking one for testing.`);

    for (const match of matches) {
        const orderId = match.retailcrm_order_id;
        const call = match.raw_telphin_calls as any;

        console.log(`--- Testing Order ${orderId} ---`);
        console.log(`Call ID: ${call.event_id}, Duration: ${call.duration_sec}s, Has Transcript: ${!!call.transcript}`);

        // Trigger the AI route via fetch to local API (simulate real production call)
        // Note: Running in dryRun mode
        const res = await fetch('http://localhost:3000/api/ai/route-orders', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                limit: 1, // Process only this one if we can filter, but current API processes all soglasovanie-otmeny
                dryRun: true
            })
        });

        if (res.ok) {
            const data = await res.json();
            const result = data.results.find((r: any) => r.order_id === orderId);
            if (result) {
                console.log('AI Decision:', result.target_status);
                console.log('AI Reasoning:', result.reasoning);
            } else {
                console.log('This order was not processed in the batch (maybe not in Soglasovanie Otmeny).');
            }
        } else {
            console.error('API Error:', await res.text());
        }
        break; // Just test one
    }
}

findTestOrder();
