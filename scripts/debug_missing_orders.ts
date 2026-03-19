
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(supabaseUrl, supabaseKey);

async function checkOrders() {
    console.log("Checking orders between 51910 and 51960...");

    // Check for orders in the range
    const { data: orders, error } = await supabase
        .from('orders')
        .select('order_id, number, status, created_at')
        .gte('number', '51910')
        .lte('number', '51960')
        .order('number', { ascending: true });

    if (error) {
        console.error("Error fetching orders:", error);
        return;
    }

    console.log(`Found ${orders?.length || 0} orders in database:`);
    orders?.forEach(o => {
        console.log(`- #${o.number} (ID: ${o.order_id}), Status: ${o.status}, Created: ${o.created_at}`);
    });

    // Also check if they exist but have different numbers (sometimes they are different)
    // Looking at order_id might be more reliable if 'number' is a string and formatted differently
}

checkOrders();
