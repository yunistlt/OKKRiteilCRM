
import { supabase } from './utils/supabase';

async function countContactPersons() {
    // We can't use filters on JSONB columns directly in .from('orders').select('*').not('raw_payload->contactPerson', 'is', null) 
    // unless the Supabase operator supports it.
    // Instead, I'll use a raw query or just a generic filter if possible.
    
    // Actually, I'll use rpc if there is one that lets me run raw sql, but there isn't usually.
    // I'll try to use the .not('raw_payload->contactPerson', 'is', null) syntax if it works.
    
    const { count, error } = await supabase
        .from('orders')
        .select('*', { count: 'exact', head: true })
        .not('raw_payload->contactPerson', 'is', null);
    
    if (error) {
        console.log('Error querying JSONB column directly:', error.message);
        // Fallback: try to find any corporate customer and then check their orders
        const { data: clients } = await supabase.from('clients').select('id, company_name').limit(20);
        console.log('Sample corporate clients IDs:', clients?.map(c => c.id).join(', '));
    } else {
        console.log(`Found ${count} orders with contactPerson in raw_payload.`);
    }
}

countContactPersons();
