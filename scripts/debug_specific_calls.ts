
import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const supabase = createClient(supabaseUrl, supabaseKey);

async function check() {
    console.log('--- Debugging Specific Calls for Missing Orders ---');

    // Order #50840 (Phone 89097217267) -> Expect call ~ Jan 13
    const phone1 = '9097217267';
    console.log(`\nSearching calls for ${phone1} (Order #50840)...`);

    const { data: calls1 } = await supabase
        .from('raw_telphin_calls')
        .select('*')
        .or(`from_number.ilike.%${phone1}%,to_number.ilike.%${phone1}%`)
        .order('started_at', { ascending: false })
        .limit(5);

    if (calls1 && calls1.length > 0) {
        for (const c of calls1) {
            console.log(`Call ${c.telphin_call_id} at ${c.started_at}`);
            // Check match
            const { data: m } = await supabase.from('call_order_matches').select('*').eq('telphin_call_id', c.telphin_call_id);
            console.log('  Match:', m);
        }
    } else {
        console.log('  No calls found.');
    }

    // Order #50835 (Phone 89269450715) -> Expect call ~ Jan 12
    const phone2 = '9269450715';
    console.log(`\nSearching calls for ${phone2} (Order #50835)...`);

    const { data: calls2 } = await supabase
        .from('raw_telphin_calls')
        .select('*')
        .or(`from_number.ilike.%${phone2}%,to_number.ilike.%${phone2}%`)
        .order('started_at', { ascending: false })
        .limit(5);

    if (calls2 && calls2.length > 0) {
        for (const c of calls2) {
            console.log(`Call ${c.telphin_call_id} at ${c.started_at}`);
            // Check match
            const { data: m } = await supabase.from('call_order_matches').select('*').eq('telphin_call_id', c.telphin_call_id);
            console.log('  Match:', m);
        }
    } else {
        console.log('  No calls found.');
    }
}

check();
