
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(supabaseUrl!, supabaseKey!);

async function auditUsage() {
    console.log('🔍 Auditing AI Usage (Last 72 Hours)...');

    const now = new Date();
    const threeDaysAgo = new Date(now.getTime() - 72 * 60 * 60 * 1000).toISOString();

    // 0. Check configured models (Price impact!)
    console.log('\n--- Model Configuration ---');
    const { data: prompts, error: pError } = await supabase.from('ai_prompts').select('key, model, is_active');
    if (pError) console.error('Error fetching prompts:', pError);
    else console.table(prompts || []);

    // 1. Check Routing Logs
    console.log('\n--- Usage Stats ---');
    const { count: routingCount, error: rError } = await supabase
        .from('ai_routing_logs')
        .select('*', { count: 'exact', head: true })
        .gte('created_at', threeDaysAgo);

    if (rError) console.error('Error checking routing logs:', JSON.stringify(rError));
    else console.log(`🤖 AI Order Routing Requests: ${routingCount}`);

    // 2. Transcriptions
    // Check raw_telphin_calls for recently added calls
    const { count: callsRecent, error: cError } = await supabase
        .from('raw_telphin_calls')
        .select('*', { count: 'exact', head: true })
        .gte('created_at', threeDaysAgo);

    if (cError) console.error('Error checking calls:', JSON.stringify(cError));
    else console.log(`📞 Calls Inserted (Last 72h): ${callsRecent}`);

    // Call Transcriptions (calls with non-null transcript)
    const { count: transCount, error: tError } = await supabase
        .from('raw_telphin_calls')
        .select('*', { count: 'exact', head: true })
        .gte('created_at', threeDaysAgo)
        .not('transcript', 'is', null);

    if (tError) {
        console.error('Error checking active transcripts:', JSON.stringify(tError));
    } else {
        console.log(`🎙️  Transcribed Calls (Last 72h): ${transCount}`);
    }

    // 3. Violations (Analysis runs)
    const { count: violationCount, error: vError } = await supabase
        .from('okk_violations')
        .select('*', { count: 'exact', head: true })
        .gte('created_at', threeDaysAgo);

    if (vError) console.error('Error checking violations:', JSON.stringify(vError));
    else console.log(`👮‍♂️ Violation Checks Recorded: ${violationCount}`);
}

auditUsage();
