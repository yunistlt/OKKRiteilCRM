
import { supabase } from './utils/supabase';

async function checkClients() {
    const { data, error } = await supabase
        .from('clients')
        .select('*')
        .limit(5);
    
    if (error) {
        console.error('Error fetching clients:', error);
    } else {
        console.log('Clients data:', JSON.stringify(data, null, 2));
    }
}

checkClients();
