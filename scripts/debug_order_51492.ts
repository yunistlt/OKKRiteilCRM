
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://lywtzgntmibdpgoijbty.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imx5d3R6Z250bWliZHBnb2lqYnR5Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2NzAzMzE4NSwiZXhwIjoyMDgyNjA5MTg1fQ.9jHVzGXQ8Rd2e4Bpe7tcWtq-hUCMvV9QaQSVsVZmPZw';

const supabase = createClient(supabaseUrl, supabaseKey);

async function getAuditContext(orderId: number) {
    let latestCallTranscript: string | undefined = undefined;
    let latestEmailText: string | undefined = undefined;

    try {
        const { data: matchedCalls } = await supabase
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

        if (matchedCalls && matchedCalls.length > 0) {
            const calls = matchedCalls
                .map((m: any) => m.raw_telphin_calls)
                .filter(Boolean)
                .sort((a, b: any) => new Date(b.started_at).getTime() - new Date(a.started_at).getTime());

            const latestCall = calls[0];
            if (latestCall) {
                latestCallTranscript = latestCall.transcript;
            }
        }

        const { data: comms } = await supabase
            .from('raw_order_events')
            .select('event_type, raw_payload, occurred_at')
            .eq('retailcrm_order_id', orderId)
            .or('event_type.ilike.%comment%,event_type.ilike.%message%,event_type.ilike.%email%')
            .order('occurred_at', { ascending: false })
            .limit(3);

        if (comms && comms.length > 0) {
            const inboundComm = comms.find((c: any) =>
                String(c.raw_payload?.source).toLowerCase() === 'user' ||
                String(c.event_type).includes('customer') ||
                String(c.event_type).includes('mess')
            );
            if (inboundComm) {
                const payload = inboundComm.raw_payload;
                latestEmailText = payload?.newValue || payload?.text || payload?.value || JSON.stringify(payload);
            }
        }

    } catch (auditErr) {
        console.error(`[Audit] Context gathering failed:`, auditErr);
    }

    return { latestCallTranscript, latestEmailText };
}

async function debug() {
    const orderId = 51492;
    console.log(`--- DEBUGGING ORDER ${orderId} ---`);

    try {
        const { data: order } = await supabase.from('orders').select('*').eq('id', orderId).single();
        console.log('Local DB Order:', order);

        const context = await getAuditContext(orderId);
        console.log('Audit Context:', JSON.stringify(context, null, 2));

        const { data: metrics } = await supabase.from('order_metrics').select('insights').eq('retailcrm_order_id', orderId).single();
        console.log('Anna Insights:', JSON.stringify(metrics?.insights, null, 2));

        const { data: logs } = await supabase.from('ai_routing_logs').select('*').eq('order_id', orderId).order('created_at', { ascending: false }).limit(3);
        console.log('Recent Routing Logs:', JSON.stringify(logs, null, 2));

        const { data: promptData } = await supabase.from('prompts').select('content').eq('key', 'order_routing_main').single();
        console.log('Custom Prompt:', promptData?.content ? 'PRESENT' : 'MISSING');
        if (promptData?.content) {
            console.log('--- CUSTOM PROMPT CONTENT ---');
            console.log(promptData.content);
        }

    } catch (e: any) {
        console.error('Debug script failed:', e.message);
    }
}

debug();
