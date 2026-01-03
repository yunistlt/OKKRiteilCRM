
import { supabase } from '../utils/supabase';

async function main() {
    console.log('Checking system_prompts table...');
    const { data, error } = await supabase
        .from('system_prompts')
        .select('*');

    if (error) {
        console.error('Error:', error.message);
        // code 42P01 means undefined table
        console.error('Code:', error.code);
    } else {
        console.log('Success! Rows:', data.length);
        console.log('Data:', data);
    }
}

main();
