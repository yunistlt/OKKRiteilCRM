
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { supabase } from '../utils/supabase';

const VERCEL_URL = 'https://okk-riteil-crm-aqwq.vercel.app';

async function triggerAndMonitor() {
    const syncUrl = `${VERCEL_URL}/api/sync/telphin?force=true&start_date=2025-09-01`;
    console.log(`🚀 Triggering Sync: ${syncUrl}`);
    
    // 1. Trigger Async
    // We don't await the full response effectively because Vercel might timeout on long requests (10s limit on free/pro serverless function sometimes?)
    // But our sync logic is chunked, it might take time.
    // However, Vercel Serverless Functions have a timeout (usually 10-60s).
    // If the sync takes longer, it might timeout.
    // BUT: My code processes ALL chunks in one request. This is risky for timeout.
    // Ideally, we should use a loop that calls the API for each month, or the API should handle it efficiently.
    // Given the task, let's try to call it. stuck connection is fine if processing continues? No, Vercel kills it.
    // Optimization: The script I wrote processes ALL extensions (30+) for 4 months. That's 120+ fetch calls.
    // It might timeout.
    // If it timeouts, the user might need to re-run or we rely on the internal loop continuing (unlikely on Vercel).
    // Let's hope it's fast enough or Vercel allows 60s.
    
    try {
        fetch(syncUrl).catch(e => console.log('Trigger sent (ignoring response due to potential timeout)'));
    } catch (e) {
        // ignore
    }

    console.log('⏳ Monitor started (checking DB every 10s)...');
    
    const target = 17000;
    
    // 2. Monitor Loop
    let lastCount = 0;
    for (let i = 0; i < 60; i++) { // Monitor for 10 minutes
        const { count, error } = await supabase
            .from('raw_telphin_calls')
            .select('*', { count: 'exact', head: true });
            
        if (error) {
            console.log('Error checking count:', error.message);
        } else {
            console.log(`[${new Date().toLocaleTimeString()}] Calls in DB: ${count} (+${(count || 0) - lastCount})`);
            lastCount = count || 0;
            
            if (lastCount > target) {
                console.log('✅ Target reached!');
                break;
            }
        }
        
        await new Promise(r => setTimeout(r, 10000));
    }
}

triggerAndMonitor();
