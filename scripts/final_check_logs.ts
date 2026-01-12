
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

async function check() {
    const { data: logs } = await supabase
        .from('ai_routing_logs')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(10);

    console.log(JSON.stringify(logs, null, 2));
}

check();
