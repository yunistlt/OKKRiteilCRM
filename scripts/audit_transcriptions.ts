
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { supabase } from '../utils/supabase';

async function run() {
    console.log('--- 📊 DATABASE TRANSCRIPTION AUDIT ---\n');

    // 1. Legacy table
    const { count: legacyCount, error: err1 } = await supabase.from('calls').select('id', { count: 'exact', head: true }).not('transcript', 'is', null);
    if (err1) console.error('Err1:', err1);
    console.log(`1. В старой таблице [calls]: ${legacyCount}`);

    // 2. Raw table - new column
    const { count: rawColCount } = await supabase.from('raw_telphin_calls').select('*', { count: 'exact', head: true }).not('transcript', 'is', null);
    console.log(`2. В новой таблице [raw_telphin_calls] (колонка transcript): ${rawColCount}`);

    // 3. Raw table - old payload field
    const { count: rawPayloadCount } = await supabase.from('raw_telphin_calls').select('*', { count: 'exact', head: true }).not('raw_payload->transcript', 'is', null);
    console.log(`3. В новой таблице [raw_telphin_calls] (внутри JSON-пейлоада): ${rawPayloadCount}`);

    // 4. TOTAL UNIQUE in Raw
    const { count: totalRawUnique } = await supabase
        .from('raw_telphin_calls')
        .select('*', { count: 'exact', head: true })
        .or('transcript.not.is.null,raw_payload->>transcript.not.is.null');
    console.log(`4. Всего уникальных транскрипций в новой системе: ${totalRawUnique}\n`);

    // 5. Working Statuses check
    const { data: workingSettings } = await supabase.from('status_settings').select('code').eq('is_working', true);
    const workingCodes = (workingSettings || []).map(s => s.code);

    // 6. Linked to Working Orders (What the UI shows for "MATCHED")
    const { count: linkedWorkingTranscribedNew } = await supabase
        .from('raw_telphin_calls')
        .select('telphin_call_id, call_order_matches!inner(orders!inner(status))', { count: 'exact', head: true })
        .in('call_order_matches.orders.status', workingCodes)
        .or('transcript.not.is.null,raw_payload->>transcript.not.is.null');

    console.log(`5. Транскрибировано И привязано к АКТИВНЫМ заказам (НОВАЯ ЛОГИКА): ${linkedWorkingTranscribedNew}`);

    const { count: linkedWorkingTranscribedOld } = await supabase
        .from('raw_telphin_calls')
        .select('telphin_call_id, call_order_matches!inner(orders!inner(status))', { count: 'exact', head: true })
        .in('call_order_matches.orders.status', workingCodes)
        .not('raw_payload->transcript', 'is', null);

    console.log(`5b. Транскрибировано И привязано к АКТИВНЫМ заказам (СТАРАЯ ЛОГИКА): ${linkedWorkingTranscribedOld}`);

    // 7. Linked to ANY Orders
    const { count: allLinkedTranscribed } = await supabase
        .from('raw_telphin_calls')
        .select('telphin_call_id, call_order_matches!inner(*)', { count: 'exact', head: true })
        .or('transcript.not.is.null,raw_payload->>transcript.not.is.null');

    console.log(`6. Транскрибировано И привязано к ЛЮБЫМ заказам: ${allLinkedTranscribed}`);
}

run();
