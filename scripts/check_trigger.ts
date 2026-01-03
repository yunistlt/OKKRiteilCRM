
import { supabase } from '../utils/supabase';
import fs from 'fs';
import path from 'path';

// Load Env
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
    }
} catch (e) { }

async function run() {
    const { data, error } = await supabase.rpc('get_triggers', { table_name: 'orders' });
    // RPC might not exist. 
    // Query information_schema not possible via client?
    // Supabase client only allows public schema access usually.
    // Try raw query if RPC fails?

    // Actually, I can try to use `postgres` pg library if available?
    // User env: `node`. `pg` might not be installed.

    // If I can't find trigger name, I can try to update `updated_at` and see if it sticks?
    // If backfill used `upsert` and it failed to stick, it means trigger overrides it.
    // Backfill logic:
    // .upsert({ ..., updated_at: ... })

    // Let's TRY to update ONE record with old date and see if it persists.
    // If it persists, then `upsert` in backfill might have passed `new Date()` or something?
    // Or I noticed `backfill` script log said "Updated At: 2026..." 

    // I'll try to update order 12398 to '2021-01-01'.

    const testId = 12398;
    console.log(`Updating order ${testId} to 2021...`);

    const { data: up, error: upErr } = await supabase
        .from('orders')
        .update({ updated_at: '2021-01-01T00:00:00Z' })
        .eq('id', testId)
        .select();

    console.log('Update Result:', up, upErr);

    if (up && up.length > 0) {
        console.log('New Updated At:', up[0].updated_at);
        if (up[0].updated_at.startsWith('2021')) {
            console.log('SUCCESS: Trigger does NOT override explicit update.');
        } else {
            console.log('FAIL: Trigger overrides update.');
        }
    }
}

run();
