
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

async function testOrderSpecificHistory() {
    const orderId = 48136;
    const apiKey = process.env.RETAILCRM_API_KEY!;
    const crmUrl = process.env.RETAILCRM_URL!;

    // Testing alternative endpoint format: /orders/{id}/history or /orders/history/id
    // some systems use this. RetailCRM usually doesn't, but let's check.
    const url = `${crmUrl}/api/v5/orders/${orderId}/history?apiKey=${apiKey}`;

    console.log(`🔍 Testing URL: ${url}`);

    const response = await fetch(url);
    const data = await response.json();

    console.log(`Status: ${response.status}`);
    console.log(`Body: ${JSON.stringify(data, null, 2)}`);
}

testOrderSpecificHistory();
