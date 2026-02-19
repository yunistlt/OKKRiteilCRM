
import { evaluateChecklist } from '../lib/quality-control';
import { supabase } from '../utils/supabase';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

async function test() {
    console.log('Testing evaluation for call 68028...');

    // Fetch the transcript for call 68028
    const { data: call, error } = await supabase
        .from('raw_telphin_calls')
        .select('transcript')
        .eq('telphin_call_id', '68028') // Or however it is indexed
        .single();

    if (error || !call) {
        // Try event_id? The audit showed call_id 68028 in violations
        const { data: call2, error: error2 } = await supabase
            .from('raw_telphin_calls')
            .select('transcript')
            .eq('event_id', '68028')
            .single();

        if (error2 || !call2) {
            console.error('Call not found:', error || error2);
            return;
        }
        call.transcript = call2.transcript;
    }

    const { data: rule } = await supabase
        .from('okk_rules')
        .select('checklist')
        .eq('is_active', true)
        .limit(1)
        .single();

    if (!rule) {
        console.error('Active rule not found');
        return;
    }

    try {
        console.log('Transcript sample:', call.transcript?.substring(0, 100));
        const result = await evaluateChecklist(call.transcript, rule.checklist);
        console.log('Result:', JSON.stringify(result, null, 2));
    } catch (e) {
        console.error('Test Failed:', e);
    }
}

test();
