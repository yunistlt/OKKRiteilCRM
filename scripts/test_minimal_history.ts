
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

async function testMinimalHistory() {
    const orderId = 48136;
    const apiKey = process.env.RETAILCRM_API_KEY!;
    const crmUrl = process.env.RETAILCRM_URL!;

    // Try without URLSearchParams, just raw string
    const url = `${crmUrl}/api/v5/orders/history?apiKey=${apiKey}&filter[orderIds][0]=${orderId}`;

    console.log(`🔍 Testing URL: ${url}`);

    const response = await fetch(url);
    const data = await response.json();

    if (data.success) {
        console.log('✅ Success! Found entries:', data.history.length);
        console.log(JSON.stringify(data.history[0], null, 2));
    } else {
        console.log('❌ Failed:', JSON.stringify(data, null, 2));
    }
}

testMinimalHistory();
