
import { supabase } from '../utils/supabase';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

async function syncBacklogSites() {
    console.log('🔄 Syncing sites for backlog orders...');

    // 1. Get orders without site
    const { data: orders, error } = await supabase
        .from('orders')
        .select('id')
        .eq('status', 'soglasovanie-otmeny')
        .is('site', null);

    if (error) {
        console.error('❌ DB Error:', error);
        return;
    }

    if (!orders || orders.length === 0) {
        console.log('✅ All backlog orders already have sites.');
        return;
    }

    console.log(`📦 Found ${orders.length} orders needing site sync.`);

    const BATCH_SIZE = 50;
    for (let i = 0; i < orders.length; i += BATCH_SIZE) {
        const batch = orders.slice(i, i + BATCH_SIZE);
        const ids = batch.map(o => o.id);

        console.log(`Fetching site data for batch ${i / BATCH_SIZE + 1}...`);

        const baseUrl = process.env.RETAILCRM_URL;
        const apiKey = process.env.RETAILCRM_API_KEY;
        const idParams = ids.map(id => `filter[ids][]=${id}`).join('&');

        try {
            const res = await fetch(`${baseUrl}/api/v5/orders?apiKey=${apiKey}&${idParams}&limit=100`);
            const data = await res.json();

            if (!data.success) {
                console.error(`❌ CRM Error for batch:`, data);
                continue;
            }

            const crmOrders = data.orders || [];
            console.log(`Received ${crmOrders.length} orders from CRM.`);

            for (const crmOrder of crmOrders) {
                const { error: upErr } = await supabase
                    .from('orders')
                    .update({ site: crmOrder.site })
                    .eq('id', crmOrder.id);

                if (upErr) console.error(`❌ Error updating order ${crmOrder.id}:`, upErr);
            }
        } catch (err: any) {
            console.error('❌ Fetch Error:', err.message);
        }
    }

    console.log('🎉 Site sync complete.');
}

syncBacklogSites();
