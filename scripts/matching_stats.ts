import { supabase } from '../utils/supabase';

async function run() {
    const { count } = await supabase
        .from('call_order_matches')
        .select('*', { count: 'exact', head: true });

    console.log('\n===========================================');
    console.log('  TOTAL MATCHES FOUND');
    console.log('===========================================\n');
    console.log(`  Total: ${count} matches\n`);

    // Breakdown by confidence
    const { data: all } = await supabase
        .from('call_order_matches')
        .select('confidence_score');

    const high = all?.filter(s => s.confidence_score >= 0.95).length || 0;
    const medium = all?.filter(s => s.confidence_score >= 0.85 && s.confidence_score < 0.95).length || 0;
    const low = all?.filter(s => s.confidence_score >= 0.70 && s.confidence_score < 0.85).length || 0;

    console.log('CONFIDENCE BREAKDOWN:');
    console.log(`  High (0.95+):      ${high} matches (${(high / count! * 100).toFixed(1)}%)`);
    console.log(`  Medium (0.85-0.94): ${medium} matches (${(medium / count! * 100).toFixed(1)}%)`);
    console.log(`  Low (0.70-0.84):    ${low} matches (${(low / count! * 100).toFixed(1)}%)\n`);

    // Stats
    const { data: stats } = await supabase
        .from('call_order_matches')
        .select('telphin_call_id, retailcrm_order_id');

    const uniqueCalls = new Set(stats?.map(s => s.telphin_call_id)).size;
    const uniqueOrders = new Set(stats?.map(s => s.retailcrm_order_id)).size;

    console.log('COVERAGE:');
    console.log(`  Unique calls matched: ${uniqueCalls}`);
    console.log(`  Unique orders matched: ${uniqueOrders}`);
    console.log(`  Avg matches per call: ${(count! / uniqueCalls).toFixed(1)}\n`);
}

run();
