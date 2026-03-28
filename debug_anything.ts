
import { supabase } from './utils/supabase';

async function findAnything() {
    const { data: clients, error } = await supabase
        .from('clients')
        .select('*')
        .limit(10);
    
    if (clients) {
        console.log('Sample clients data keys:', Object.keys(clients[0] || {}));
        clients.forEach(c => {
            console.log(`Client ${c.id}: ${c.company_name} | Email: ${c.email} | Phones: ${JSON.stringify(c.phones)}`);
        });
    }
    
    // Check if there are ANY orders with a non-null email in raw_payload
    const { data: orders } = await supabase
        .from('orders')
        .select('id, number, raw_payload')
        .limit(20);
    
    if (orders) {
        orders.forEach(o => {
            const email = o.raw_payload?.customer?.email || o.raw_payload?.contactPerson?.email || o.raw_payload?.email;
            if (email) {
                console.log(`Order ${o.number} has email: ${email}`);
            }
        });
    }
}

findAnything();
