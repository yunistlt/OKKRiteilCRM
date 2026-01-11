
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

async function inspectOrderDetails() {
    const orderId = 48136;
    const apiKey = process.env.RETAILCRM_API_KEY!;
    const crmUrl = process.env.RETAILCRM_URL!;

    const url = `${crmUrl}/api/v5/orders?apiKey=${apiKey}&filter[numbers][]=${orderId}`;

    console.log(`🔍 Fetching order #${orderId}...`);

    const response = await fetch(url);
    const data = await response.json();

    if (data.success && data.orders.length > 0) {
        const order = data.orders[0];
        console.log('✅ Order found:');
        console.log(`  CreatedAt: ${order.createdAt}`);
        console.log(`  UpdatedAt: ${order.updatedAt}`);
        console.log(`  StatusUpdatedAt: ${order.statusUpdatedAt}`);
        console.log(`  ManagerComment: "${order.managerComment}"`);
    } else {
        console.log('❌ Failed:', JSON.stringify(data, null, 2));
    }
}

inspectOrderDetails();
