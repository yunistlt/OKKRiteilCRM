
import dotenv from 'dotenv';
import path from 'path';
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

async function checkPrompts() {
    const { data: prompts } = await supabase
        .from('system_prompts')
        .select('key, content, description');

    console.log('--- Current Prompts in DB ---');
    prompts?.forEach(p => {
        console.log(`\nKEY: ${p.key}`);
        console.log(`DESC: ${p.description}`);
        console.log(`START OF CONTENT: ${p.content.substring(0, 100)}...`);
    });
}

checkPrompts();
