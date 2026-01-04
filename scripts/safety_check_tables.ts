
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { supabase } from '../utils/supabase';

async function checkDateRanges() {
    console.log('--- SAFETY CHECK: Date Ranges ---');

    async function getRange(table: string, dateCol: string) {
        const { data: min, error: e1 } = await supabase.from(table).select(dateCol).order(dateCol, { ascending: true }).limit(1);
        const { data: max, error: e2 } = await supabase.from(table).select(dateCol).order(dateCol, { ascending: false }).limit(1);
        const { count } = await supabase.from(table).select('*', { count: 'exact', head: true });

        if (e1 || e2) return { error: e1 || e2 };
        return {
            min: min?.[0]?.[dateCol],
            max: max?.[0]?.[dateCol],
            count
        };
    }

    const calls = await getRange('calls', 'timestamp');
    const rawCalls = await getRange('raw_telphin_calls', 'started_at');

    console.log(`\nLEGACY 'calls':`);
    console.log(`Count: ${calls.count}`);
    console.log(`Range: ${calls.min}  <->  ${calls.max}`);

    console.log(`\nNEW 'raw_telphin_calls':`);
    console.log(`Count: ${rawCalls.count}`);
    console.log(`Range: ${rawCalls.min}  <->  ${rawCalls.max}`);

    if (calls.min && rawCalls.min && new Date(calls.min) < new Date(rawCalls.min)) {
        console.log(`\n⚠️ WARNING: Legacy table has older data! (${calls.min} vs ${rawCalls.min})`);
    } else {
        console.log(`\n✅ New table covers the date range (approx).`);
    }
}

checkDateRanges();
