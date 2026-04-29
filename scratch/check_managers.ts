import { supabase } from './utils/supabase';

async function checkManagers() {
    const { data, error } = await supabase.from('managers').select('*').limit(1);
    console.log('Data:', JSON.stringify(data, null, 2));
    console.log('Error:', error);
}

checkManagers();
