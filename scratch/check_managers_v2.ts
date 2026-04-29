import { supabase } from '../utils/supabase';

async function checkManagers() {
    const { data, error } = await supabase.from('managers').select('*').limit(1);
    if (error) {
        console.error('Error:', error);
    } else if (data && data.length > 0) {
        console.log('Columns:', Object.keys(data[0]));
        console.log('Sample data:', JSON.stringify(data[0], null, 2));
    } else {
        console.log('No managers found');
    }
}

checkManagers();
