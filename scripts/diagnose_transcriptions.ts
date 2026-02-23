import { supabase } from '../utils/supabase';

async function diagnose() {
    console.log('--- SYSTEM CONFIGURATION: Transcribable Statuses ---');
    const { data: settings } = await supabase.from('status_settings').select('code, is_transcribable').order('code');
    const transcribableCodes = settings?.filter(s => s.is_transcribable).map(s => s.code) || [];
    console.log('Transcribable Statuses:', transcribableCodes.join(', '));

    const orderNums = ['51839', '51844', '51846', '51847', '51848', '51849', '51850', '51854', '51861', '51862', '51864', '51865', '51866', '51867', '51869', '51870', '51871', '51874', '51877'];
    console.log('\n--- ORDER INVESTIGATION ---');

    const { data: orders } = await supabase.from('orders').select('id, number, status').in('number', orderNums);

    for (const num of orderNums) {
        const order = orders?.find(o => o.number === num);
        if (!order) {
            console.log(`#${num}: NOT FOUND IN DB`);
            continue;
        }

        const isTransStatus = transcribableCodes.includes(order.status);
        console.log(`\n#${num} | Status: ${order.status} | Transcribable Config: ${isTransStatus ? 'YES' : 'NO'}`);

        const { data: matches } = await supabase
            .from('call_order_matches')
            .select('retailcrm_order_id, raw_telphin_calls!inner(*)')
            .eq('retailcrm_order_id', order.id);

        console.log(`Matched calls: ${matches?.length || 0}`);

        matches?.forEach(m => {
            const c = m.raw_telphin_calls as any;
            console.log(`  - Call ${c.event_id}:`);
            console.log(`    Dur: ${c.duration_sec}s | Rec: ${c.recording_url ? 'YES' : 'NO'} | TransStatus: ${c.transcription_status} | HasTranscript: ${c.transcript ? 'YES' : 'NO'}`);
        });
    }
}

diagnose();
