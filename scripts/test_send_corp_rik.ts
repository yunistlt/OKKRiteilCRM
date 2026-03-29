import { supabase } from '../utils/supabase';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const RETAILCRM_URL = 'https://zmktlt.retailcrm.ru';
const RETAILCRM_API_KEY = process.env.RETAILCRM_API_KEY;

async function send() {
    console.log('--- CORPORATE TEST SEND START ---');
    const corpId = '426'; // ЗАО "РИК" Corporate ID
    const logId = 'e05982f0-5d43-4ea8-85d0-b259778f647c';
    
    const { data: log, error: logError } = await supabase
        .from('ai_outreach_logs')
        .select('*')
        .eq('id', logId)
        .single();
    
    if (logError || !log) {
        console.error('Log not found in DB:', logError);
        return;
    }

    // Текст письма для теста
    const text = log.generated_email ?? 'Тестовое письмо от Виктории. Проверка РЕАЛЬНОГО триггера на корпоративном клиенте.';
    
    // Формат данных для Corporate Customer
    const customerData = {
        customFields: {
            ai_reactivation_text: text,
            ai_reactivation_status: 'sent' // Вероятно, триггер срабатывает на это поле
        }
    };

    console.log(`Sending update to Corporate Customer ${corpId}...`);
    const url = `${RETAILCRM_URL}/api/v5/customers-corporate/${corpId}/edit?apiKey=${RETAILCRM_API_KEY}&site=zmktlt-ru&by=id`;
    
    const body = `customerCorporate=${encodeURIComponent(JSON.stringify(customerData))}`;

    try {
        const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body
        });

        const data = await res.json();
        console.log('CRM Response:', data);

        if (data.success) {
            console.log('Verifying fields in CRM...');
            const getRes = await fetch(`${RETAILCRM_URL}/api/v5/customers-corporate/${corpId}?apiKey=${RETAILCRM_API_KEY}&by=id&site=zmktlt-ru`);
            const getData = await getRes.json();
            console.log('Verified Custom Fields on Corp 426:', getData.customerCorporate?.customFields);
        } else {
            console.error('CRM Error Message:', data.errorMsg);
        }
    } catch (e: any) {
        console.error('Fetch error:', e.message);
    }
}

send();
