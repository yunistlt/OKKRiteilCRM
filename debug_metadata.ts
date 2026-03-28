
import { supabase } from './utils/supabase';

async function findTableMetadata() {
    // Try to find if there are any tables related to contact persons
    const tables = ['contact_persons', 'customer_contacts', 'contacts', 'company_contacts'];
    for (const t of tables) {
        const { count, error } = await supabase.from(t).select('*', { count: 'exact', head: true });
        if (!error) {
            console.log(`Table ${t} exists with ${count} records!`);
        }
    }
    
    // Check clients again, specifically for contact person data in custom_fields
    const { data: clients, error: cErr } = await supabase
        .from('clients')
        .select('*')
        .not('first_name', 'is', null)
        .limit(3);
    
    if (clients && clients.length > 0) {
        console.log('Found clients with first_name (contact person):', clients.length);
    } else {
        console.log('No clients with first_name found (in sample/not null).');
    }
}

findTableMetadata();
