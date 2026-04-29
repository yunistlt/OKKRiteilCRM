import { supabase } from '@/utils/supabase';

async function getCrmConfig() {
    const url = process.env.RETAILCRM_URL || process.env.RETAILCRM_BASE_URL;
    const key = process.env.RETAILCRM_API_KEY;
    const site = process.env.RETAILCRM_SITE;
    if (!url || !key) throw new Error('RetailCRM config missing: URL or API_KEY');
    if (!site) throw new Error('RetailCRM config missing: RETAILCRM_SITE (shop code) is not set in environment variables');
    return { url: url.replace(/\/+$/, ''), key, site };
}

async function fetchRetailCrm(path: string, method: 'GET' | 'POST', body?: any) {
    const { url: baseUrl, key: apiKey } = await getCrmConfig();
    const url = `${baseUrl}/api/v5/${path}?apiKey=${apiKey}`;

    const response = await fetch(url, {
        method,
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: body ? new URLSearchParams({ [path.split('/')[0].slice(0, -1)]: JSON.stringify(body) }).toString() : undefined,
    });

    // RetailCRM API uses form-encoded JSON for POST... wait, let me check documentation or existing patterns.
    // Actually, many RetailCRM versions use application/x-www-form-urlencoded with a JSON string in one of the fields.
    // But some modern ones support JSON.
    // Let's use the most common one: application/x-www-form-urlencoded with field name = JSON string.
    
    // Correction: Standard RetailCRM POST is often: 
    // POST /api/v5/orders/create?apiKey=...
    // body: order={"status":"new",...}
    
    const responseData = await response.json();
    if (!responseData.success) {
        throw new Error(`RetailCRM Error: ${JSON.stringify(responseData.errors || responseData.message)}`);
    }
    return responseData;
}

// More standard fetch for RetailCRM
async function postRetailCrm(path: string, rootKey: string, data: any, site?: string) {
    const { url: baseUrl, key: apiKey, site: configSite } = await getCrmConfig();
    const targetSite = site || configSite;
    const url = `${baseUrl}/api/v5/${path}?apiKey=${apiKey}${targetSite ? `&site=${targetSite}` : ''}`;
    
    const body = new URLSearchParams();
    body.append(rootKey, JSON.stringify(data));
    if (site) {
        body.append('site', site);
    }

    const response = await fetch(url, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: body.toString()
    });

    const result = await response.json();
    return result;
}

export async function findCustomerByPhone(phone: string) {
    const { url: baseUrl, key: apiKey } = await getCrmConfig();
    const url = `${baseUrl}/api/v5/customers?apiKey=${apiKey}&filter[name]=${phone}`;
    const response = await fetch(url);
    const data = await response.json();
    if (data.success && data.customers && data.customers.length > 0) {
        return data.customers[0];
    }
    return null;
}

export async function createLeadInCrm(params: {
    name: string;
    phone?: string;
    email?: string;
    telegram?: string;
    query_summary: string;
    domain?: string;
    utm?: any;
    items?: string[];
    city?: string;
    history?: Array<{ role: string; content: string }>;
    visitedPages?: Array<{ url: string; title: string }>;
}) {
    console.log('Creating lead in RetailCRM:', params);

    // 1. Find or Create Customer
    let customerId: number | null = null;
    const existing = params.phone ? await findCustomerByPhone(params.phone) : null;
    
    if (existing) {
        customerId = existing.id;
    } else {
        const { site } = await getCrmConfig();
        const customerResult = await postRetailCrm('customers/create', 'customer', {
            firstName: params.name || 'Клиент из чата',
            phones: params.phone ? [{ number: params.phone }] : [],
            email: params.email
        }, site);
        if (customerResult.success) {
            customerId = customerResult.id;
        } else {
            console.error('Failed to create customer:', customerResult);
        }
    }

    // 3. Format Manager Comment
    const visitedPagesStr = params.visitedPages?.slice(-5).map(p => p.url).join(', ') || 'неизвестно';
    const cityStr = params.city || 'не определен';
    const telegramStr = params.telegram ? `Telegram: ${params.telegram}` : '';
    
    let historyLog = '';
    if (params.history) {
        historyLog = params.history.map(h => `${h.role === 'user' ? 'Клиент' : 'ИИ'}: ${h.content}`).join('\n');
    }

    const managerComment = `🔥 НОВЫЙ ЛИД ИЗ ИИ-ЧАТА

📍 ГЕО: ${cityStr}
📱 КОНТАКТЫ: ${telegramStr || params.phone || params.email || 'указаны в карточке'}

📝 СУТЬ ЗАПРОСА (Анализ от Семёна):
${params.query_summary}

-------------------------------------------
🔎 ДЕТАЛИ:
- Страницы: ${visitedPagesStr}
- Товары: ${params.items?.join(', ') || 'не указаны'}

📜 КРАТКИЙ ЛОГ ДИАЛОГА:
${historyLog.split('\n').slice(-10).join('\n')}
`;

    // 2. Create Order/Lead
    const orderData: any = {
        status: 'novyi-1', // Correct code for "Новый" from dictionary
        orderMethod: 'live-chat',
        lastName: 'ИИ-Лид',
        firstName: params.name || 'Клиент',
        phone: params.phone,
        email: params.email,
        customerComment: managerComment,
        source: {
            source: params.utm?.source || 'ai-widget',
            medium: params.utm?.medium || 'chat',
            campaign: params.utm?.campaign || ''
        }
    };

    if (customerId) {
        orderData.customer = { id: customerId };
    }

    if (params.items && params.items.length > 0) {
        orderData.customerComment += `\nИнтересовался товарами: ${params.items.join(', ')}`;
    }

    const { site: configSite } = await getCrmConfig();
    const orderResult = await postRetailCrm('orders/create', 'order', orderData, configSite);
    
    if (!orderResult.success) {
        console.error('Failed to create order:', JSON.stringify(orderResult, null, 2));
        const errorMessage = orderResult.errors ? JSON.stringify(orderResult.errors) : (orderResult.errorMsg || 'Unknown error');
        throw new Error(`CRM Order Creation Failed: ${errorMessage} (Full response: ${JSON.stringify(orderResult)})`);
    }

    return orderResult;
}
