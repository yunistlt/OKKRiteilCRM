import { supabase } from '../utils/supabase';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const RETAILCRM_URL = 'https://zmktlt.retailcrm.ru';
const RETAILCRM_API_KEY = process.env.RETAILCRM_API_KEY;
const APP_URL = 'https://okk.zmksoft.com';

async function send() {
    console.log('--- TEST SEND START ---');
    const logId = 'e05982f0-5d43-4ea8-85d0-b259778f647c';
    const crmId = '7089';
    
    const { data: log, error: logError } = await supabase
        .from('ai_outreach_logs')
        .select('*')
        .eq('id', logId)
        .single();
    
    if (logError || !log) {
        console.error('Log not found:', logError);
        return;
    }

    const pixelHtml = `\n<img src="${APP_URL}/api/reactivation/pixel?id=${logId}" width="1" height="1" style="display:none;" />`;
    const finalEmail = log.generated_email + pixelHtml;

    console.log('Sending to RetailCRM for ID:', crmId);
    const url = `${RETAILCRM_URL}/api/v5/customers/${crmId}/edit?apiKey=${RETAILCRM_API_KEY}&site=zmktlt-ru&by=id`;
    
    const params = new URLSearchParams();
    params.append('customer', JSON.stringify({
        customFields: {
            ai_reactivation_text: finalEmail,
            ai_reactivation_status: 'sent'
        }
    }));

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);

    try {
        const res = await fetch(url, {
            method: 'POST',
            body: params,
            signal: controller.signal
        });

        const data = await res.json();
        clearTimeout(timeout);

        console.log('CRM Response:', data);
        if (!data.success) {
            console.error('CRM Error:', data.errorMsg || data.errors);
            return;
        }

        console.log('CRM Update Success. Updating Supabase...');
        
        await supabase
            .from('ai_outreach_logs')
            .update({
                status: 'sent',
                sent_at: new Date().toISOString(),
                generated_email: finalEmail
            })
            .eq('id', logId);

        console.log('✅ Approved and SENT to ЗАО РИК');
    } catch (e: any) {
        console.error('Fetch error:', e.message);
    }
}

send();
