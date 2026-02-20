import { runInsightAnalysis } from './lib/insight-agent';
import { supabase } from './utils/supabase';

async function demo() {
    console.log('🚀 Starting Insight Agent Demo...');

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
    const orderNumber = (recentOrders[0].orders as any)?.number;

    console.log(`\n🕵️‍♂️ Analyzing Order #${orderNumber} (ID: ${orderId})...`);
    console.log('--- This might take 10-20 seconds (AI processing) ---');

    const insights = await runInsightAnalysis(orderId);

    if (insights) {
        console.log('\n✅ ANALYSIS COMPLETE:');
        console.log('====================================');
        console.log(`📝 SUMMARY: ${insights.summary}`);
        console.log('\n👥 LPR (Decision Maker):');
        console.log(`   Name: ${insights.lpr?.name || 'Not identified'}`);
        console.log(`   Role: ${insights.lpr?.role || 'Not identified'}`);
        console.log(`   Influence: ${insights.lpr?.influence || 'Unknown'}`);

        console.log('\n💰 BUDGET:');
        console.log(`   Amount: ${insights.budget?.amount || 'Not explicitly mentioned'}`);
        console.log(`   Status: ${insights.budget?.status || 'Unknown'}`);

        console.log('\n⚠️ PAIN POINTS:');
        if (insights.pain_points && insights.pain_points.length > 0) {
            insights.pain_points.forEach(p => console.log(`   • ${p}`));
        } else {
            console.log('   No specific pain points identified.');
        }

        console.log('\n🏗 TECHNICAL REQUIREMENTS:');
        if (insights.technical_requirements && insights.technical_requirements.length > 0) {
            insights.technical_requirements.forEach(r => console.log(`   • ${r}`));
        } else {
            console.log('   No specific technical requirements identified.');
        }
        console.log('====================================');
        console.log('\n✨ This data is now stored in the database and visible in the System Monitor.');
    } else {
        console.log('\n❌ Analysis failed or produced no insights.');
    }
}

demo().catch(console.error);
