import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const RETAILCRM_URL = 'https://zmktlt.retailcrm.ru';
const RETAILCRM_API_KEY = process.env.RETAILCRM_API_KEY;

async function test() {
    const customerId = '19464'; // Основной контакт ЗАО "РИК"
    const text = 'Уважаемый Андрей Анатольевич! Тестовое письмо от Виктории. Финальная проверка триггера через контактное лицо №19464.';
    
    const customerData = {
        customFields: {
            ai_reactivation_text: text
        }
    };
    
    const body = `customer=${encodeURIComponent(JSON.stringify(customerData))}`;
    
    const url = `${RETAILCRM_URL}/api/v5/customers/${customerId}/edit?apiKey=${RETAILCRM_API_KEY}&site=zmktlt-ru&by=id`;
    
    console.log('--- TRIGGER FIRE ATTEMPT ---');
    console.log(`Updating Contact Person ${customerId} at ${url}...`);
    
    try {
        const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body
        });

        const data: any = await res.json();
        console.log('CRM Response:', data);

        if (data.success) {
            console.log('✅ Success! Trigger should fire now.');
            
            // Verify fields
            const getRes = await fetch(`${RETAILCRM_URL}/api/v5/customers/${customerId}?apiKey=${RETAILCRM_API_KEY}&by=id&site=zmktlt-ru`);
            const getData: any = await getRes.json();
            console.log('Verified Fields on Contact 19464:', getData.customer?.customFields?.ai_reactivation_text ? 'PRESENT' : 'MISSING');
        } else {
            console.error('CRM Error:', data.errorMsg);
        }
    } catch (e: any) {
        console.error('Execution Error:', e.message);
    }
}

test();
