
import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import { runInsightAnalysis } from '../lib/insight-agent';
import { analyzeOrderForRouting } from '../lib/ai-router';

dotenv.config({ path: '.env.local' });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://lywtzgntmibdpgoijbty.supabase.co';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

const supabase = createClient(supabaseUrl, supabaseKey);

async function verifySequentialSynergy() {
    const orderId = 51492;
    console.log(`--- VERIFYING SEQUENTIAL SYNERGY FOR ORDER ${orderId} ---`);

    // 1. Run Anna's Analysis
    console.log('Step 1: Running Anna (Analyst)...');
    const insights = await runInsightAnalysis(orderId);
    console.log('Anna Insights summary:', insights?.summary);

    // 2. Fetch Audit Context
    const { data: matchedCalls } = await supabase
        .from('call_order_matches')
        .select('raw_telphin_calls(*)')
        .eq('retailcrm_order_id', orderId);

    const callTranscript = matchedCalls?.[0]?.raw_telphin_calls?.transcript;

    const { data: comms } = await supabase
        .from('raw_order_events')
        .select('raw_payload')
        .eq('retailcrm_order_id', orderId)
        .or('event_type.ilike.%comment%,event_type.ilike.%message%,event_type.ilike.%email%')
        .limit(1);

    const emailText = comms?.[0]?.raw_payload?.newValue || comms?.[0]?.raw_payload?.text;

    const auditContext = {
        latestCallTranscript: callTranscript,
        latestEmailText: emailText
    };

    // 3. Run Maxim's Analysis
    console.log('Step 2: Running Maxim (Auditor) with Anna\'s insights...');

    // Fetch comment manually as in route.ts
    const { data: logEntry } = await supabase
        .from('ai_routing_logs')
        .select('manager_comment')
        .eq('order_id', orderId)
        .order('created_at', { ascending: false })
        .limit(1)
        .single();

    const comment = logEntry?.manager_comment || '';

    // Simplified status map for test
    const allowedStatuses = new Map([
        ['otmenen-propala-neobkhodimost', 'Пропала необходимость'],
        ['novyi-1', 'Новый'],
        ['cancel-other', 'Другая причина отмены']
    ]);

    const decision = await analyzeOrderForRouting(
        comment,
        allowedStatuses,
        { currentTime: new Date().toISOString(), orderUpdatedAt: new Date().toISOString() },
        auditContext,
        undefined,
        insights
    );

    console.log('--- FINAL DECISION ---');
    console.log('Status:', decision.target_status);
    console.log('Confidence:', decision.confidence);
    console.log('Reasoning:', decision.reasoning);
}

verifySequentialSynergy();
