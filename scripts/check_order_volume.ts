
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { supabase } from '../utils/supabase';

async function checkVolume() {
    console.log('=== CHECKING ORDER VOLUME (LAST 30 DAYS) ===');

    // Group by date (simplified)
    const { data: orders, error } = await supabase
        .from('orders')
        .select('created_at')
        .gte('created_at', '2025-12-01T00:00:00+00:00')
        .order('created_at', { ascending: true });

    if (error) {
        console.error("Error fetching orders:", error);
        return;
    }

    const counts: Record<string, number> = {};
    orders?.forEach(o => {
        const date = o.created_at.split('T')[0];
        counts[date] = (counts[date] || 0) + 1;
    });

    Object.keys(counts).sort().forEach(date => {
        const count = counts[date];
        const bar = '█'.repeat(Math.ceil(count / 10));
        console.log(`${date}: ${count.toString().padEnd(4)} ${bar}`);
    });
}

checkVolume().catch(console.error);
