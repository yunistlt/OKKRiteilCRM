
import { supabase } from './utils/supabase';

async function findClientWithEmail() {
    const { data: clients, error } = await supabase
        .from('clients')
        .select('*')
        .not('email', 'is', null)
        .limit(3);
    
    if (error) {
        console.error('Error fetching clients:', error);
    } else {
        console.log(`Found ${clients.length} clients with email.`);
        clients.forEach(c => {
            console.log(`Client ${c.id}: ${c.company_name} | Email: ${c.email}`);
        });
    }
}

findClientWithEmail();
