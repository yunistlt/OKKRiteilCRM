
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

async function getOrderHistory() {
    const orderId = 48136; // The order with the misclassification

    // We filter history by orderId and field 'manager_comment'
    const params = new URLSearchParams({
        apiKey: process.env.RETAILCRM_API_KEY!,
        'filter[orderIds][]': String(orderId),
        'filter[fields][]': 'manager_comment',
        limit: '20'
    });

    const url = `${process.env.RETAILCRM_URL}/api/v5/orders/history?${params.toString()}`;
    console.log(`🔍 Fetching history for order #${orderId}...`);
    console.log(`URL: ${url}`);

    const response = await fetch(url);
    const data = await response.json();

    if (data.success) {
        console.log('✅ History fetched successfully:');
        if (data.history && data.history.length > 0) {
            data.history.forEach((h: any) => {
                console.log(`--- Record at ${h.createdAt} ---`);
                console.log(`Field: ${h.field}`);
                console.log(`Old Value: ${h.oldValue}`);
                console.log(`New Value: ${h.newValue}`);
                console.log('------------------------------');
            });
        } else {
            console.log('No history records found for manager_comment.');
        }
    } else {
        console.log('❌ Failed to fetch history:', JSON.stringify(data, null, 2));
    }
}

getOrderHistory();
