
import { getStoredPriorities } from '../lib/prioritization';
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
    // Dynamic import to allow env to load
    const { getStoredPriorities } = await import('../lib/prioritization');

    console.log('Fetching stored priorities...');
    const items = await getStoredPriorities(3000);
    console.log(`Returned Items: ${items.length}`);

    if (items.length <= 1000) {
        console.log('FAIL: Limit is likely 1000.');
    } else {
        console.log('SUCCESS: Limit breached > 1000.');
    }
}

run();
