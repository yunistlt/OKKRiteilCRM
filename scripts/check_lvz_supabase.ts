import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const lvzUrl = process.env.LVZ_SUPABASE_URL!;
const lvzKey = process.env.LVZ_SUPABASE_ANON_KEY!;

const lvzSupabase = createClient(lvzUrl, lvzKey);

async function check() {
    console.log('Checking LVZ Supabase at:', lvzUrl);
    
    // Try to find match functions by querying the functions/RPC through a common pattern
    // In Supabase REST API we can't easily list functions without admin key,
    // but we can try to call a likely name.
    
    const likelyNames = ['match_ai_knowledge', 'match_knowledge_chunks', 'match_knowledge'];
    
    for (const name of likelyNames) {
        const { error } = await lvzSupabase.rpc(name, {
            query_embedding: new Array(1536).fill(0),
            match_threshold: 0.5,
            match_count: 1
        });
        
        if (!error || error.message.includes('argument')) {
            console.log('✅ Found function:', name);
            process.exit(0);
        } else {
            console.log('❌ Function not found:', name, error.message);
        }
    }
}
check();
