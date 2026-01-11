
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

async function testWithManagerComment() {
    const orderId = 48258;

    console.log('🧪 Testing WITH managerComment...\n');

    const requestBody = {
        status: 'soglasovanie-otmeny', // Change back to original status
        managerComment: 'ОКК: Тестовый комментарий от AI'
    };

    const response = await fetch(`${process.env.RETAILCRM_URL}/api/v5/orders/${orderId}/edit?by=id`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
            apiKey: process.env.RETAILCRM_API_KEY!,
            site: 'zmktlt-ru',
            order: JSON.stringify(requestBody)
        })
    });

    const data = await response.json();

    console.log('📊 Response:');
    console.log(JSON.stringify(data, null, 2));
}

testWithManagerComment();
