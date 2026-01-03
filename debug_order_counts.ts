
import { supabase } from './utils/supabase';

async function debugOrderCounts() {
    console.log('--- Order Count Debug ---');

    // 1. Total Orders
    const { count: total, error: e1 } = await supabase.from('orders').select('*', { count: 'exact', head: true });
    if (e1) console.error('Error counting total:', e1);
    console.log('Total Orders in DB:', total);

    // 2. Working Statuses
    const { data: workingSettings, error: e2 } = await supabase.from('status_settings').select('code, is_working').eq('is_working', true);
    if (e2) console.error('Error fetching settings:', e2);
    const workingCodes = (workingSettings || []).map(s => s.code);
    console.log('Working Status Codes:', workingCodes.join(', '));

    // 3. Group by Status
    // 1387 is small enough to fetch all statuses.
    const { data: orders, error: e3 } = await supabase.from('orders').select('status').limit(10000);
    if (e3) console.error('Error fetching orders:', e3);

    const counts: Record<string, number> = {};
    (orders || []).forEach(o => {
        const s = o.status || 'NULL';
        counts[s] = (counts[s] || 0) + 1;
    });

    console.log('\n--- Counts per Status ---');
    let calculatedWorking = 0;
    let calculatedNonWorking = 0;

    Object.entries(counts).sort((a, b) => b[1] - a[1]).forEach(([status, count]) => {
        const isWorking = workingCodes.includes(status);
        if (isWorking) calculatedWorking += count;
        else calculatedNonWorking += count;

        console.log(`[${isWorking ? 'WORKING' : 'OTHER  '}] ${status}: ${count}`);
    });

    console.log('\n--- Summary ---');
    console.log('Total Calculated (JS):', calculatedWorking + calculatedNonWorking);
    console.log('Active (Working) Orders:', calculatedWorking);
    console.log('Other Orders:', calculatedNonWorking);
    console.log('Discrepancy target (RetailCRM 1387 - DB Working):', 1387 - calculatedWorking);
}

debugOrderCounts();
