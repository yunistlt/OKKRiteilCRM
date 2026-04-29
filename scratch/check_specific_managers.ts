import { supabase } from '../utils/supabase';

async function checkSpecificManagers() {
    const ids = [249, 114, 153, 335]; // Need to verify these IDs for the names mentioned
    const names = ['Гордеева', 'Парфенова', 'Матвеева', 'Хапилова'];
    
    const { data, error } = await supabase
        .from('managers')
        .select('id, first_name, last_name, telphin_extension')
        .in('last_name', names);
        
    if (error) {
        console.error('Error:', error);
    } else {
        console.log('Managers Data:', JSON.stringify(data, null, 2));
    }
}

checkSpecificManagers();
