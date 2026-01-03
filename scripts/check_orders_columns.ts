import { supabase } from '../utils/supabase';

async function checkSchema() {
    console.log('🔍 Checking orders table data...');
    const { data, error } = await supabase
        .from('orders')
        .select('*')
        .limit(1);

    if (error) {
        console.error('❌ Error:', error);
        return;
    }

    if (data && data.length > 0) {
        console.log('Columns found in first order:');
        Object.keys(data[0]).forEach(key => {
            console.log(`- ${key}: ${data[0][key]}`);
        });
    } else {
        console.log('No orders found in database.');
    }
}

checkSchema().catch(console.error);
