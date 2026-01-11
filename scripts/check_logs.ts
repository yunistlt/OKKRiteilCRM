
import { supabase } from '../utils/supabase';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

async function checkLatestLogs() {
    const { data } = await supabase
        .from('ai_routing_logs')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(3);

    console.log('📋 Last 3 AI Routing Logs:\n');
    data?.forEach((log, i) => {
        console.log(`${i + 1}. Order #${log.order_id}`);
        console.log(`   Status: ${log.from_status} → ${log.to_status}`);
        console.log(`   Applied: ${log.was_applied ? '✅ YES' : '❌ NO'}`);
        console.log(`   Time: ${log.created_at}`);
        console.log(`   Reasoning: ${log.ai_reasoning}`);
        console.log('');
    });
}

checkLatestLogs();
