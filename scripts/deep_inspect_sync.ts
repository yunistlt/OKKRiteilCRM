
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { supabase } from '../utils/supabase';

async function deepInspect() {
    console.log('=== DEEP SYNC INSPECTION ===');

    // 1. Check Total Count
    const { count, error: countError } = await supabase
        .from('raw_telphin_calls')
        .select('*', { count: 'exact', head: true });

    console.log(`Total Calls in DB: ${count ?? 'Error: ' + countError?.message}`);

    // 2. Check Latest Ingestion (When was the DB last written to?)
    // assuming 'ingested_at' exists (saw it in route.ts) or 'created_at' logic
    // route.ts line 186: ingested_at: new Date().toISOString()
    const { data: lastIngested } = await supabase
        .from('raw_telphin_calls')
        .select('telphin_call_id, started_at, ingested_at')
        .order('ingested_at', { ascending: false })
        .limit(5);

    console.log('\n--- Latest Ingested Records (Real-time activity) ---');
    if (lastIngested && lastIngested.length > 0) {
        lastIngested.forEach((c, i) => {
            console.log(`${i + 1}. Ingested: ${c.ingested_at} | CallTime: ${c.started_at} | ID: ${c.telphin_call_id}`);
        });
    } else {
        console.log("No records found by ingestion time.");
    }

    // 3. Check Sync States (All keys)
    console.log('\n--- Sync States ---');
    const { data: states } = await supabase
        .from('sync_state')
        .select('*');

    states?.forEach(s => {
        console.log(`Key: ${s.key.padEnd(25)} | Value: ${s.value} | Updated: ${s.updated_at}`);
    });

    // 4. Verify Latest Call Time (Business Data freshness)
    const { data: latestCall } = await supabase
        .from('raw_telphin_calls')
        .select('started_at')
        .order('started_at', { ascending: false })
        .limit(1);

    console.log(`\nNewest Call Time (by started_at): ${latestCall?.[0]?.started_at}`);

    // 5. Oldest Call Tiime
    const { data: oldestCall } = await supabase
        .from('raw_telphin_calls')
        .select('started_at')
        .order('started_at', { ascending: true })
        .limit(1);

    console.log(`Oldest Call Time (by started_at): ${oldestCall?.[0]?.started_at}`);
}

deepInspect().catch(console.error);
