
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { supabase } from '../utils/supabase';

const RETAILCRM_URL = process.env.RETAILCRM_URL || process.env.RETAILCRM_BASE_URL;
const RETAILCRM_API_KEY = process.env.RETAILCRM_API_KEY;

function cleanPhone(val: any): string {
    if (!val) return '';
    return String(val).replace(/[^\d+]/g, '');
}

async function debugSingleOrder() {
    const ORDER_ID = '50829';
    console.log(`🔎 Debugging Single Order Fetch: ${ORDER_ID}`);

    if (!RETAILCRM_URL || !RETAILCRM_API_KEY) {
        console.error('❌ Config missing');
        return;
    }

    // 1. Fetch from CRM
    const url = `${RETAILCRM_URL}/api/v5/orders/${ORDER_ID}?apiKey=${RETAILCRM_API_KEY}&by=id`;
    console.log(`📡 Fetching from: ${url}`);

    try {
        const res = await fetch(url);
        if (!res.ok) {
            console.error(`❌ API Error: ${res.status}`);
            console.error(await res.text());
            return;
        }

        const data = await res.json();
        if (!data.success) {
            console.error('❌ CRM Success=false:', data);
            return;
        }

        const order = data.order;
        console.log('✅ Fetched Order Data:');
        console.log(`   ID: ${order.id}`);
        console.log(`   Number: ${order.number}`);
        console.log(`   Status: ${order.status}`);
        console.log(`   Created: ${order.createdAt}`);

        // 2. Prepare payload for Insertion
        // Extract phones
        const phones = new Set<string>();
        const p1 = cleanPhone(order.phone);
        if (p1) phones.add(p1);
        const p2 = cleanPhone(order.additionalPhone);
        if (p2) phones.add(p2);
        if (order.customer && order.customer.phones) {
            order.customer.phones.forEach((p: any) => {
                const cp = cleanPhone(p.number);
                if (cp) phones.add(cp);
            });
        }

        const payload = {
            id: order.id,
            order_id: order.id, // for consistency if column exists
            created_at: order.createdAt,
            updated_at: new Date().toISOString(),
            number: order.number || String(order.id),
            status: order.status,
            manager_id: order.managerId ? String(order.managerId) : null,
            phone: cleanPhone(order.phone) || null,
            customer_phones: Array.from(phones),
            totalsumm: order.totalSumm || 0,
            raw_payload: order // Assuming column exists
        };

        console.log('\n💾 Attempting Direct Insert into `orders` table...');

        // We try standard upsert first. 
        // Note: The schema for 'orders' table might differ from my payload guess.
        // I will stick to the columns I verified in your SQL query + standard ones.

        const { error } = await supabase
            .from('orders')
            .upsert(payload);

        if (error) {
            console.error('❌ DB Insert Error:', error);

            // Fallback: maybe schema is stricter? 
            // Let's try minimal payload?
            // Or maybe 'raw_payload' column doesn't exist in 'orders'? 
            // In the previous task steps, we assumed 'orders' was renovated.
        } else {
            console.log('✅ Insert Successful! Order should be in DB now.');
        }

    } catch (e) {
        console.error('❌ Unexpected Error:', e);
    }
}

debugSingleOrder();
