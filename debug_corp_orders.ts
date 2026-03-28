
import { supabase } from './utils/supabase';

async function findCorporateOrders() {
    const { data: orders, error } = await supabase
        .from('orders')
        .select('id, number, raw_payload')
        .limit(10);
    
    if (error) {
        console.error('Error fetching orders:', error);
    } else {
        const corpOrders = orders.filter(o => 
            o.raw_payload?.customer?.type === 'corporate' || 
            o.raw_payload?.customer?.type === 'legal-entity' ||
            o.raw_payload?.contactPerson
        );
        
        console.log(`Found ${corpOrders.length} potential corporate orders in sample.`);
        corpOrders.forEach(o => {
            console.log(`Order ${o.number}:`);
            console.log('Customer Type:', o.raw_payload?.customer?.type);
            console.log('Company:', o.raw_payload?.customer?.nickName || o.raw_payload?.customer?.legalName);
            console.log('Contact Person:', o.raw_payload?.contactPerson?.firstName);
        });
    }
}

findCorporateOrders();
