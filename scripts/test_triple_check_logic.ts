import dotenv from 'dotenv';
import path from 'path';
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

import { supabase } from '../utils/supabase';
import { analyzeOrderForRouting } from '../lib/ai-router';
import { transcribeCall, isTranscribable } from '../lib/transcribe';

async function getAuditContext(orderId: number) {
    let latestCallTranscript: string | undefined = undefined;
    let latestEmailText: string | undefined = undefined;

    try {
        const { data: matchedCalls, error: matchedError } = await supabase
            .from('call_order_matches')
            .select(`
                telphin_call_id,
                raw_telphin_calls (
                    event_id,
                    transcript,
                    recording_url,
                    duration_sec,
                    started_at,
                    direction
                )
            `)
            .eq('retailcrm_order_id', orderId)
            .limit(5);

        if (!matchedError && matchedCalls && matchedCalls.length > 0) {
            const calls = matchedCalls
                .map((m: any) => m.raw_telphin_calls)
                .filter(Boolean)
                .sort((a, b) => new Date(b.started_at).getTime() - new Date(a.started_at).getTime());

            const latestCall = calls[0];
            if (latestCall) {
                if (latestCall.transcript) {
                    latestCallTranscript = latestCall.transcript;
                } else if (isTranscribable(latestCall)) {
                    console.log(`[Audit] Testing: found transcribable call ${latestCall.event_id}`);
                    // We won't actually transcribe in a test script unless needed
                }
            }
        }

        const { data: comms } = await supabase
            .from('raw_order_events')
            .select('event_type, raw_payload')
            .eq('retailcrm_order_id', orderId)
            .or('event_type.ilike.%comment%,event_type.ilike.%message%,event_type.ilike.%email%')
            .order('occurred_at', { ascending: false })
            .limit(3);

        if (comms && comms.length > 0) {
            const inboundComm = comms.find((c: any) =>
                String(c.raw_payload?.source).toLowerCase() === 'user' ||
                String(c.event_type).includes('customer')
            );
            if (inboundComm) {
                const payload = inboundComm.raw_payload;
                latestEmailText = payload?.newValue || payload?.text || payload?.value || JSON.stringify(payload);
            }
        }
    } catch (err) {
        console.error('Audit gathering error:', err);
    }
    return { latestCallTranscript, latestEmailText };
}

async function testTripleCheckLogic() {
    console.log('🚀 Testing Triple Check Logic with Mock Data...');

    const statuses = new Map([
        ['cancel-other', 'Купили в другом месте'],
        ['tender-process', 'Тендер'],
        ['soglasovanie-otmeny', 'Согласование отмены']
    ]);

    const systemContext = {
        currentTime: new Date().toISOString(),
        orderUpdatedAt: new Date().toISOString()
    };

    // Case 1: Conflict (Manager says Cancel, Call says Price)
    console.log('\n--- Case 1: Manager Cancel vs Call Price ---');
    const audit1 = {
        latestCallTranscript: "Да, здравствуйте. Я по счету 48133. Вы прислали цену 10000, а мы рассчитывали на 8000. Можете сделать скидку? Если да, то будем заказывать.",
        latestEmailText: undefined
    };
    const comment1 = "Клиент слился, дорого. В отмену.";

    const result1 = await analyzeOrderForRouting(comment1, statuses, systemContext, audit1);
    console.log('Target Status:', result1.target_status);
    console.log('Reasoning:', result1.reasoning);

    // Case 2: Correspondence (Manager says Cancel, Call says Bought elsewhere)
    console.log('\n--- Case 2: Agreement ---');
    const audit2 = {
        latestCallTranscript: "Не актуально уже, мы вчера в другом месте все купили. Спасибо, до свидания.",
        latestEmailText: undefined
    };
    const comment2 = "отмена, купили у других";

    const result2 = await analyzeOrderForRouting(comment2, statuses, systemContext, audit2);
    console.log('Target Status:', result2.target_status);
    console.log('Reasoning:', result2.reasoning);
}

testTripleCheckLogic();
