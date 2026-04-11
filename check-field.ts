
import { supabase } from './utils/supabase.ts';

async function check() {
    console.log('--- DB CHECK START ---');
    
    // Check Dictionary
    const { data: dicts, error: dictError } = await supabase
        .from('retailcrm_dictionaries')
        .select('*')
        .eq('dictionary_code', 'prichiny_otmeny');
    
    if (dictError) {
        console.error('Dictionary Error:', dictError.message);
    } else {
        console.log(`Found ${dicts?.length || 0} items for prichiny_otmeny in retailcrm_dictionaries.`);
        dicts?.forEach(d => console.log(` - ${d.item_code}: ${d.item_name}`));
    }

    // Check Sample Orders
    console.log('\nChecking latest orders for field prichiny_otmeny...');
    const { data: testOrders, error: orderError } = await supabase
        .from('orders')
        .select('id, status, prichiny_otmeny')
        .order('id', { ascending: false })
        .limit(10);

    if (orderError) {
        console.error('Order Table Error:', orderError.message);
        if (orderError.message.includes('column "prichiny_otmeny" does not exist')) {
            console.log('RESULT: Column "prichiny_otmeny" IS MISSING from orders table.');
        }
    } else {
        console.log('RESULT: Column "prichiny_otmeny" EXISTS.');
        const withValue = testOrders.filter(o => o.prichiny_otmeny);
        console.log(`Matched ${withValue.length} / ${testOrders.length} recent orders with this field.`);
        withValue.forEach(o => console.log(` Order #${o.id}: ${o.prichiny_otmeny}`));
    }
    
    console.log('--- DB CHECK END ---');
}

check().catch(console.error);
