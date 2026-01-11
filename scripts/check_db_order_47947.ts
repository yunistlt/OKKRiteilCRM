
import { supabase } from '../utils/supabase';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

async function checkOrderInDB() {
    const orderId = 47947;
    const { data: order, error } = await supabase
        .from('orders')
        .select('*')
        .eq('id', orderId)
        .single();

    if (error) {
        console.error('Error:', error);
        return;
    }

    console.log('📂 Order #47947 in DB:');
    console.log('  Status:', order.status);
    console.log('  Manager Comment (from payload):', order.raw_payload?.managerComment);
    console.log('  Full Payload:', JSON.stringify(order.raw_payload, null, 2));
}

checkOrderInDB();
