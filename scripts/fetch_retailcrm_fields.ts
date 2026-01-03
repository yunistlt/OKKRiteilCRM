import * as dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

const RETAILCRM_URL = process.env.RETAILCRM_URL;
const RETAILCRM_API_KEY = process.env.RETAILCRM_API_KEY;

async function fetchRetailCRMFields() {
    if (!RETAILCRM_URL || !RETAILCRM_API_KEY) {
        console.error('❌ RetailCRM credentials not found in .env.local');
        process.exit(1);
    }

    console.log('🔍 Fetching custom fields from RetailCRM...\n');

    try {
        // 1. Get custom fields for orders
        console.log('📋 Custom Fields for Orders:');
        console.log('='.repeat(80));
        const customFieldsUrl = `${RETAILCRM_URL}/api/v5/custom-fields/orders?apiKey=${RETAILCRM_API_KEY}`;
        const customFieldsRes = await fetch(customFieldsUrl);
        const customFieldsData = await customFieldsRes.json();

        if (customFieldsData.success && customFieldsData.customFields) {
            customFieldsData.customFields.forEach((field: any) => {
                console.log(`\n📌 ${field.name} (${field.code})`);
                console.log(`   Type: ${field.type}`);
                console.log(`   Display: ${field.displayArea}`);
                if (field.entity) console.log(`   Entity: ${field.entity}`);
            });
        }

        // 2. Get one real order to see actual structure
        console.log('\n\n📦 Sample Order Structure:');
        console.log('='.repeat(80));
        const ordersUrl = `${RETAILCRM_URL}/api/v5/orders?apiKey=${RETAILCRM_API_KEY}&limit=1`;
        const ordersRes = await fetch(ordersUrl);
        const ordersData = await ordersRes.json();

        if (ordersData.success && ordersData.orders && ordersData.orders.length > 0) {
            const order = ordersData.orders[0];
            console.log(`\nOrder #${order.number}:`);
            console.log('\nStandard Fields:');
            Object.keys(order).forEach(key => {
                if (key !== 'customFields' && key !== 'items' && key !== 'payments' && key !== 'delivery') {
                    console.log(`  - ${key}: ${typeof order[key]}`);
                }
            });

            if (order.customFields) {
                console.log('\nCustom Fields in this order:');
                Object.keys(order.customFields).forEach(key => {
                    const value = order.customFields[key];
                    console.log(`  - ${key}: ${value} (${typeof value})`);
                });
            }

            console.log('\n\n📄 Full Order JSON:');
            console.log('='.repeat(80));
            console.log(JSON.stringify(order, null, 2));
        }

        // 3. Get reference fields (like order types, statuses, etc.)
        console.log('\n\n📚 Reference Data:');
        console.log('='.repeat(80));

        const referenceUrl = `${RETAILCRM_URL}/api/v5/reference/order-types?apiKey=${RETAILCRM_API_KEY}`;
        const referenceRes = await fetch(referenceUrl);
        const referenceData = await referenceRes.json();

        if (referenceData.success && referenceData.orderTypes) {
            console.log('\nOrder Types:');
            Object.entries(referenceData.orderTypes).forEach(([code, type]: [string, any]) => {
                console.log(`  - ${code}: ${type.name}`);
            });
        }

    } catch (error: any) {
        console.error('❌ Error:', error.message);
        process.exit(1);
    }
}

fetchRetailCRMFields()
    .then(() => {
        console.log('\n\n✅ Done!');
        process.exit(0);
    })
    .catch(err => {
        console.error('❌ Fatal error:', err);
        process.exit(1);
    });
