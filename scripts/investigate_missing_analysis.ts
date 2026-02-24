import { supabase } from '../utils/supabase';

async function investigate() {
    const orderNumbers = [51844, 51847, 51854, 51861, 51862, 51864, 51865, 51866, 51867, 51871, 51874];
    console.log('Investigating orders:', orderNumbers);

    for (const num of orderNumbers) {
        // 1. Get order ID and current status
        const { data: order } = await supabase
            .from('orders')
            .select('id, number, status')
            .eq('number', num)
            .single();

        if (!order) {
            console.log(`Order #${num} not found`);
            continue;
        }

        // 2. Get matched calls
        const { data: matches } = await supabase
            .from('call_order_matches')
            .select(`
                id,
                telphin_call_id,
                calls:raw_telphin_calls(*)
            `)
            .eq('retailcrm_order_id', order.id);

        console.log(`\n--- Order #${num} (Status: ${order.status}) ---`);
        console.log(`Matched calls: ${matches?.length || 0}`);

        if (matches) {
            for (const m of matches) {
                const call = m.calls as any;
                console.log(`  Call ID: ${call?.telphin_call_id}`);
                console.log(`    Duration: ${call?.duration_sec}s`);
                console.log(`    Recording URL: ${call?.recording_url ? 'YES' : 'NO'}`);
                console.log(`    Transcription Status: ${call?.transcription_status}`);
                console.log(`    Has Transcript: ${call?.transcript ? 'YES' : 'NO'}`);
            }
        }
    }
}

investigate();
