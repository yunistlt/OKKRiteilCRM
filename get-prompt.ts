import { supabase } from './utils/supabase';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

async function getPrompt() {
    const { data, error } = await supabase
        .from('system_prompts')
        .select('content')
        .eq('key', 'order_analysis_main')
        .single();

    if (error) console.error(error);
    else console.log(data.content);
}

getPrompt();
