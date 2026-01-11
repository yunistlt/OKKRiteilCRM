
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

async function inspectOrder() {
    const orderId = 47947;

    const response = await fetch(
        `${process.env.RETAILCRM_URL}/api/v5/orders?apiKey=${process.env.RETAILCRM_API_KEY}&filter[numbers][]=${orderId}&limit=20`
    );

    const data = await response.json();

    if (data.success && data.orders && data.orders.length > 0) {
        const order = data.orders[0];
        console.log('📦 Order #47947 Details:');
        console.log('  Status:', order.status);
        console.log('  Site:', order.site);
        console.log('  Manager Comment:', order.managerComment);
        console.log('  Custom Fields (data_kontakta):', order.customFields?.data_kontakta);
        console.log('  Items:', order.items.map((i: any) => i.offer.displayName).join(', '));
    } else {
        console.log('❌ Order #47947 not found');
    }
}

inspectOrder();
