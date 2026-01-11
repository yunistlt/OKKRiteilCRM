
import { supabase } from '../utils/supabase';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

async function inspectOrderPayload() {
    console.log('🔍 Inspecting sample order raw_payload...');
    const { data, error } = await supabase
        .from('orders')
        .select('raw_payload')
        .limit(1);

    if (error) {
        console.error('❌ DB Error:', error);
        return;
    }

    if (data && data[0]) {
        console.log('Keys in raw_payload:', Object.keys(data[0].raw_payload || {}));
        // Look for common communication keys
        const p = data[0].raw_payload;
        if (p.comments) console.log('💬 Found "comments" in payload');
        if (p.communications) console.log('📨 Found "communications" in payload');
        if (p.messages) console.log('📩 Found "messages" in payload');
    }
}

inspectOrderPayload();
