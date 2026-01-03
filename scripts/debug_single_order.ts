
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
    // 1. Fetch one old order (e.g. updated > 30 days ago) logic check
    // We can't query by date easily without knowing active statuses, let's fetch ANY working order and check date.

    // Get working codes
    const { data: workingSettings } = await supabase.from('status_settings').select('code').eq('is_working', true);
    const workingCodes = (workingSettings || []).map(s => s.code);

    console.log(`Working statuses: ${workingCodes.length}`);

    // Fetch oldest updated order
    const { data: orders } = await supabase
        .from('orders')
        .select('*')
        .in('status', workingCodes)
        .order('id', { ascending: true }) // Oldest ID
        .limit(1);

    if (!orders || !orders.length) {
        console.log('No working orders found.');
        return;
    }

    const order = orders[0];
    console.log('Order:', order.number, 'Status:', order.status);
    console.log('Updated At:', order.updated_at);
    console.log('Created At:', order.created_at);

    // Replicate logic
    const STAGNATION_DAYS = 7;
    const now = new Date();
    const updated = new Date(order.updated_at);
    const diffTime = now.getTime() - updated.getTime();
    const diffDays = diffTime / (1000 * 3600 * 24);

    console.log('Now:', now.toISOString());
    console.log('Diff Days:', diffDays);

    let level = 'black';
    let score = 0;

    if (diffDays > STAGNATION_DAYS) {
        console.log('Rule: Stagnation hit!');
        score += 40;
        level = diffDays > 14 ? 'red' : 'yellow';
    } else {
        console.log('Rule: Stagnation NOT hit.');
    }

    // AI Check
    // ...
    if (level === 'black') {
        if (diffDays < 3) {
            console.log('Rule: Recent -> Green');
            level = 'green';
        }
    }

    console.log('Calculated Level:', level);
}

run();
