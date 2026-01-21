
import { supabase } from '@/utils/supabase';

async function diagnose() {
    console.log('--- Checking OKK Rules ---');
    const { data, error } = await supabase
        .from('okk_rules')
        .select('*');

    if (error) {
        console.error('Error fetching rules:', error);
        return;
    }

    console.log(`Total Rules: ${data.length}`);
    const active = data.filter(r => r.is_enabled);
    console.log(`Active Rules (${active.length}):`, active.map(r => r.name));

    // Check Enabled column type just in case
    console.log('Sample Rule:', data[0]);
}

diagnose();
