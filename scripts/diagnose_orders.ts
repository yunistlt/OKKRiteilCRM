
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

// Use service key if available for checking RLS
const supabase = createClient(supabaseUrl!, serviceKey || supabaseKey!);

async function diagnose() {
    console.log('--- Diagnosing Orders Table ---');
    const { count, error: countError } = await supabase.from('orders').select('*', { count: 'exact', head: true });
    if (countError) console.error('Count Error:', countError);
    else console.log('Total Orders:', count);

    const { data: lastOrder, error: lastError } = await supabase
        .from('orders')
        .select('created_at, id')
        .order('created_at', { ascending: false })
        .limit(1)
        .single();

    if (lastError) console.error('Last Order Error:', lastError);
    else console.log('Last Order:', lastOrder);

    console.log('\n--- Checking RetailCRM Connectivity ---');
    const RETAILCRM_URL = process.env.RETAILCRM_URL;
    const RETAILCRM_API_KEY = process.env.RETAILCRM_API_KEY;

    if (!RETAILCRM_URL || !RETAILCRM_API_KEY) {
        console.error('Missing RetailCRM ENV vars');
        return;
    }

    try {
        const res = await fetch(`${RETAILCRM_URL}/api/v5/orders?apiKey=${RETAILCRM_API_KEY}&limit=1`);
        const json = await res.json();
        console.log('RetailCRM Response Success:', json.success);
        if (!json.success) console.error('Error:', json.errorMsg);
    } catch (e: any) {
        console.error('Fetch Error:', e.message);
    }
}

diagnose();
