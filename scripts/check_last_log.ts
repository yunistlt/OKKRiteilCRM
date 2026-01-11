
import { supabase } from '../utils/supabase';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

async function checkLastLog() {
    const { data } = await supabase
        .from('ai_routing_logs')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(1)
        .single();

    console.log('📋 Last AI Routing Log:');
    console.log(JSON.stringify(data, null, 2));
}

checkLastLog();
