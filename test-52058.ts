import { config } from 'dotenv';
config({ path: '.env.local' });
import { supabase } from './utils/supabase';
import { collectFacts } from './lib/okk-evaluator';

async function test() {
    const { data: callMatches } = await supabase
        .from('call_order_matches')
        .select('telphin_call_id, raw_telphin_calls(started_at, duration_sec, recording_url, direction, transcript, from_number, to_number)')
        .eq('retailcrm_order_id', 52058);
    console.log("Call matches in DB:", JSON.stringify(callMatches, null, 2));

    // let's also check fallback calls
    const { data: order } = await supabase.from('orders').select('raw_payload').eq('order_id', 52058).single();
    console.log("Order phones:", order?.raw_payload?.phone, JSON.stringify(order?.raw_payload?.contact?.phones));

    const result = await collectFacts(52058);
    console.log("Evaluator logic calls_status:", result.calls_status);
}
test();
