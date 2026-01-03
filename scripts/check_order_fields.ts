import { supabase } from '../utils/supabase';

async function checkOrderFields() {
    console.log('🔍 Checking order fields in database...\n');

    // Get one order with raw_payload
    const { data: orders, error } = await supabase
        .from('orders')
        .select('id, number, raw_payload')
        .not('raw_payload', 'is', null)
        .limit(1);

    if (error) {
        console.error('❌ Error:', error);
        return;
    }

    if (!orders || orders.length === 0) {
        console.log('No orders found');
        return;
    }

    const order = orders[0];
    console.log(`📦 Order #${order.number} (ID: ${order.id})\n`);

    const payload = order.raw_payload as any;

    console.log('='.repeat(80));
    console.log('TOP-LEVEL FIELDS:');
    console.log('='.repeat(80));
    Object.keys(payload).forEach(key => {
        const value = payload[key];
        const type = typeof value;
        if (type === 'object' && value !== null) {
            console.log(`${key}: [${Array.isArray(value) ? 'Array' : 'Object'}]`);
        } else {
            console.log(`${key}: ${String(value).substring(0, 50)} (${type})`);
        }
    });

    if (payload.customFields) {
        console.log('\n' + '='.repeat(80));
        console.log('CUSTOM FIELDS:');
        console.log('='.repeat(80));
        Object.keys(payload.customFields).forEach(key => {
            const value = payload.customFields[key];
            console.log(`${key}: ${value}`);
        });
    }

    console.log('\n' + '='.repeat(80));
    console.log('FULL RAW_PAYLOAD JSON:');
    console.log('='.repeat(80));
    console.log(JSON.stringify(payload, null, 2));
}

checkOrderFields()
    .then(() => {
        console.log('\n✅ Done!');
        process.exit(0);
    })
    .catch(err => {
        console.error('❌ Error:', err);
        process.exit(1);
    });
