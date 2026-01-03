
import fs from 'fs';
import path from 'path';

// 1. Load Env Vars FIRST
try {
    const envPath = path.resolve(process.cwd(), '.env.local');
    if (fs.existsSync(envPath)) {
        const envConfig = fs.readFileSync(envPath, 'utf8');
        envConfig.split('\n').forEach(line => {
            const match = line.match(/^([^=]+)=(.*)$/);
            if (match) {
                const key = match[1].trim();
                const value = match[2].trim().replace(/^["']|["']$/g, '');
                if (!process.env[key]) process.env[key] = value;
            }
        });
        console.log('.env.local loaded.');
    }
} catch (e) { console.warn('Failed to load .env.local', e); }

async function run() {
    // 2. Dynamic Import AFTER Env is loaded
    const { supabase } = await import('../utils/supabase');
    const { calculatePriorities } = await import('../lib/prioritization');
    // ... (skipping some lines) ...
    const priorities = await calculatePriorities(3000);

    if (priorities.length === 0) {
        console.log('No priorities computed.');
        // Debug: why empty?
        const { count, error } = await supabase.from('orders').select('*', { count: 'exact', head: true });
        console.log('Total Orders Check:', count, error);
        return;
    }

    console.log(`Computed ${priorities.length} priorities. Saving to DB...`);

    const upsertData = priorities.map(p => ({
        order_id: p.orderId,
        level: p.level,
        score: p.score,
        reasons: p.reasons, // Supabase handles array -> jsonb
        summary: p.summary,
        recommended_action: p.recommendedAction || null,
        updated_at: new Date().toISOString()
    }));

    const chunkSize = 100;
    for (let i = 0; i < upsertData.length; i += chunkSize) {
        const chunk = upsertData.slice(i, i + chunkSize);
        const { error } = await supabase
            .from('order_priorities')
            .upsert(chunk, { onConflict: 'order_id' });

        if (error) {
            console.error('Upsert Error:', error);
        } else {
            console.log(`Saved batch ${i} - ${i + chunk.length}`);
        }
    }
    console.log('Done!');
}

run();
