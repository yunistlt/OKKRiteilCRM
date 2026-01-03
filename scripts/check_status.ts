import { supabase } from '../utils/supabase';

async function checkStatus() {
    const { data, error } = await supabase
        .from('status_settings')
        .select('code, name')
        .eq('code', 'soglasovanie-otmeny')
        .single();

    console.log('Query result:');
    console.log('Data:', data);
    console.log('Error:', error);

    // Also fetch all statuses
    const { data: all } = await supabase
        .from('status_settings')
        .select('code, name')
        .limit(5);

    console.log('\nFirst 5 statuses:');
    console.log(all);
}

checkStatus();
