const { createClient } = require('@supabase/supabase-js');
const OpenAI = require('openai');
require('dotenv').config({ path: '.env.local' });

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY);

async function runDemo() {
    console.log('🚀 Starting Insight Agent Demo (JS version)...');

    // 1. Get a recent order with transcripts
    const { data: recentOrders } = await supabase
        .from('call_order_matches')
        .select('retailcrm_order_id, orders(number)')
        .limit(1)
        .order('matched_at', { ascending: false });

    if (!recentOrders || recentOrders.length === 0) {
        console.log('❌ No recent orders with calls found to analyze.');
        return;
    }

    const orderId = recentOrders[0].retailcrm_order_id;
    const orderNumber = recentOrders[0].orders?.number;

    console.log(`\n🕵️‍♂️ Analyzing Order #${orderNumber} (ID: ${orderId})...`);

    // We'll manually run the core logic here for the demo to ensure it works in this script
    const { data: order } = await supabase.from('orders').select('*').eq('order_id', orderId).single();

    // Fetch interactions
    const yesterday = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const { data: callMatches } = await supabase
        .from('call_order_matches')
        .select('telphin_call_id, raw_telphin_calls(started_at, transcript, event_id)')
        .eq('retailcrm_order_id', orderId);

    const interactions = (callMatches || []).map(m => ({
        type: 'call',
        time: m.raw_telphin_calls?.started_at,
        text: m.raw_telphin_calls?.transcript
    })).filter(i => i.text);

    if (interactions.length === 0) {
        console.log('⚠️ No transcripts found for this order. Using only CRM fields.');
    }

    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    const systemPrompt = `Analyze the CRM order and interactions. Extract: LPR (Decision Maker), Budget, Pain Points, Timeline, Competitors, Technical Requirements. Output JSON. Russian summary.`;
    const userPrompt = `ORDER DATA: ${JSON.stringify(order.raw_payload)} \n\nINTERACTIONS: ${JSON.stringify(interactions)}`;

    const completion = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [{ role: "system", content: systemPrompt }, { role: "user", content: userPrompt }],
        response_format: { type: "json_object" }
    });

    const insights = JSON.parse(completion.choices[0].message.content);

    console.log('\n✅ INSIGHTS EXTRACTED:');
    console.log('------------------------------------');
    console.log(JSON.stringify(insights, null, 2));
    console.log('------------------------------------');
    console.log('\n✨ This process now happens automatically in the background for every order.');
}

runDemo().catch(console.error);
