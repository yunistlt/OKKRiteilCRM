
import { supabase } from '../utils/supabase';
import fs from 'fs';
import path from 'path';

// Load .env.local manually
try {
    const envPath = path.resolve(process.cwd(), '.env.local');
    if (fs.existsSync(envPath)) {
        const envConfig = fs.readFileSync(envPath, 'utf8');
        envConfig.split('\n').forEach(line => {
            const match = line.match(/^([^=]+)=(.*)$/);
            if (match) {
                const key = match[1].trim();
                const value = match[2].trim().replace(/^["']|["']$/g, ''); // Remove quotes
                if (!process.env[key]) {
                    process.env[key] = value;
                }
            }
        });
        console.log('.env.local loaded.');
    }
} catch (e) {
    console.warn('Failed to load .env.local', e);
}

// Helper to normalize phone numbers (same as backfill)
function cleanPhone(val: any): string {
    if (!val) return '';
    return String(val).replace(/[^\d+]/g, '');
}

async function run() {
    console.log('Starting CALL MATCHING Backfill...');

    // 1. Get IDs of known matches
    const { data: matches } = await supabase.from('matches').select('call_id');
    const matchedCallIds = new Set((matches || []).map(m => m.call_id));
    console.log(`Found ${matchedCallIds.size} existing matches.`);

    // 2. Iterate ALL calls
    let processed = 0;
    let newMatches = 0;
    let page = 0;
    const limit = 500;
    let hasMore = true;

    while (hasMore) {
        const { data: calls, error } = await supabase
            .from('calls')
            .select('*')
            .range(page * limit, (page + 1) * limit - 1)
            .order('timestamp', { ascending: false });

        if (error || !calls || calls.length === 0) {
            hasMore = false;
            break;
        }

        console.log(`Processing batch ${page + 1}: ${calls.length} calls (Total: ${processed})...`);

        for (const call of calls) {
            // Skip if already matched
            if (matchedCallIds.has(call.id)) continue;

            const callPhone = cleanPhone(call.phone);
            if (!callPhone || callPhone.length < 10) continue;

            // 3. Search for Order
            // Find order where customer_phones contains callPhone OR phone == callPhone
            // Supabase filter for array contains: .contains('customer_phones', [phone])

            const { data: orders } = await supabase
                .from('orders')
                .select('id, manager_id, status')
                .or(`phone.eq.${callPhone},customer_phones.cs.{${callPhone}}`) // .cs. = contains
                .order('created_at', { ascending: false })
                .limit(1);

            if (orders && orders.length > 0) {
                const bestOrder = orders[0];

                // Create Match
                // console.log(`MATCH FOUND: Call ${call.id} -> Order ${bestOrder.id}`);
                const { error: matchErr } = await supabase.from('matches').insert({
                    call_id: call.id,
                    order_id: bestOrder.id,
                    manager_id: bestOrder.manager_id, // Assign call to order's manager
                    is_processed: false
                });

                if (!matchErr) {
                    newMatches++;
                    matchedCallIds.add(call.id);
                } else {
                    console.error('Match insert failed:', matchErr);
                }
            }
        }

        processed += calls.length;
        page++;
    }

    console.log(`Matching Complete. Scanned ${processed} calls. Created ${newMatches} NEW matches.`);
}

run();
