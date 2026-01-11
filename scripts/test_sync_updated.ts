
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { supabase } from '../utils/supabase';

async function testSync() {
    const RETAILCRM_URL = process.env.RETAILCRM_URL || process.env.RETAILCRM_BASE_URL;
    const RETAILCRM_API_KEY = process.env.RETAILCRM_API_KEY;
    if (!RETAILCRM_URL || !RETAILCRM_API_KEY) {
        console.error('Missing credentials');
        return;
    }

    const baseUrl = RETAILCRM_URL.replace(/\/+$/, '');
    const date = new Date();
    date.setDate(date.getDate() - 2); // Go back 2 days
    const filterValue = date.toISOString().slice(0, 19).replace('T', ' ');

    const today = new Date().toISOString().split('T')[0];
    const url = `${baseUrl}/api/v5/orders?apiKey=${RETAILCRM_API_KEY}&limit=20&filter[customFields][control]=1&filter[customFields][data_kontakta]=${today}`;
    console.log('Testing direct customField filter:', url);

    try {
        const res = await fetch(url);
        const data: any = await res.json();
        console.log('API Response:', JSON.stringify(data).slice(0, 500));
        console.log('Total orders count in header:', data.pagination?.totalCount);
        console.log('Orders array length:', data.orders?.length || 0);
        console.log('Total orders updated since window:', data.orders?.length || 0);

        const controlFound = data.orders?.filter((o: any) => o.customFields?.control);
        console.log('Priority orders (control=true) found:', controlFound?.length || 0);

        if (data.orders?.length > 0) {
            console.log('Custom Fields for first order:', JSON.stringify(data.orders[0].customFields));
        }
    } catch (e) {
        console.error('Fetch error:', e);
    }
}

testSync();
