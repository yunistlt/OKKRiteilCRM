
import { supabase } from '../utils/supabase';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

async function checkEmails() {
    console.log('🔍 Searching raw_order_events for emails...');
    const { data, error } = await supabase
        .from('raw_order_events')
        .select('*')
        .or('event_type.ilike.%mail%,event_type.ilike.%message%')
        .limit(5);

    if (error) {
        console.error('❌ DB Error:', error);
        return;
    }

    if (data && data.length > 0) {
        console.log(`✅ Found ${data.length} email/message events:`);
        data.forEach(event => {
            console.log(`[${event.occurred_at}] Type: ${event.event_type} Order: ${event.retailcrm_order_id}`);
            console.log('Payload:', JSON.stringify(event.raw_payload, null, 2).slice(0, 500) + '...');
        });
    } else {
        console.log('No email/message events found in raw_order_events.');
    }
}

checkEmails();
