import { supabase } from '../utils/supabase';

async function checkOtherManagers() {
    const names = ['Парфенова', 'Матвеева', 'Хапилова'];
    
    const { data, error } = await supabase
        .from('managers')
        .select('last_name, raw_data')
        .in('last_name', names);
        
    if (error) {
        console.error('Error:', error);
    } else {
        data.forEach(m => {
            console.log(`${m.last_name}: phone=${m.raw_data?.phone}`);
        });
    }
}

checkOtherManagers();
