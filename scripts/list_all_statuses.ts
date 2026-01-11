
import { supabase } from '../utils/supabase';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

async function listAllStatuses() {
    console.log('📋 All Active Statuses:');
    const { data: statuses, error } = await supabase
        .from('statuses')
        .select('code, name, group_name, is_working')
        .eq('is_active', true)
        .order('group_name');

    if (error) {
        console.error('Error:', error);
        return;
    }

    statuses.forEach(s => {
        console.log(`[${s.group_name}] ${s.code}: ${s.name} (Working: ${s.is_working})`);
    });
}

listAllStatuses();
