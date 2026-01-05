
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { supabase } from '../utils/supabase';

function normalizePhone(val: any) {
    if (!val) return null;
    let s = String(val).replace(/[^\d]/g, '');
    if (s.length === 11 && (s.startsWith('7') || s.startsWith('8'))) {
        s = s.slice(1);
    }
    return s.length >= 10 ? s : null;
}

async function fixNormalization() {
    console.log('=== FIXING NORMALIZATION FOR SEPT 1 ===');
    const start = '2025-09-01T00:00:00+00:00';
    const end = '2025-09-01T23:59:59+00:00';

    const { data: calls, error } = await supabase
        .from('raw_telphin_calls')
        .select('*')
        .gte('started_at', start)
        .lte('started_at', end);

    if (error) { console.error(error); return; }

    console.log(`Found ${calls?.length} calls to check.`);
    if (!calls) return;

    let updated = 0;
    for (const call of calls) {
        const correctFrom = normalizePhone(call.from_number);
        const correctTo = normalizePhone(call.to_number);

        if (call.from_number_normalized !== correctFrom || call.to_number_normalized !== correctTo) {
            await supabase.from('raw_telphin_calls').update({
                from_number_normalized: correctFrom,
                to_number_normalized: correctTo
            }).eq('telphin_call_id', call.telphin_call_id);
            updated++;
        }
    }
    console.log(`Fixed ${updated} calls.`);
}

fixNormalization().catch(console.error);
