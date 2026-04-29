import { supabase } from '../utils/supabase';

async function checkGordeeva() {
    const { data, error } = await supabase
        .from('managers')
        .select('raw_data')
        .eq('id', 249)
        .single();
        
    if (error) {
        console.error('Error:', error);
    } else {
        console.log('Gordeeva raw_data:', JSON.stringify(data.raw_data, null, 2));
    }
}

checkGordeeva();
