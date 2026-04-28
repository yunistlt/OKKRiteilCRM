import { supabase } from '@/utils/supabase';

const RETAILCRM_URL = process.env.RETAILCRM_URL || process.env.RETAILCRM_BASE_URL;
const RETAILCRM_API_KEY = process.env.RETAILCRM_API_KEY;

async function fetchRetailCrm(path: string, method: 'GET' | 'POST', body?: any) {
    if (!RETAILCRM_URL || !RETAILCRM_API_KEY) {
        throw new Error('RetailCRM config missing');
    }

    const baseUrl = RETAILCRM_URL.replace(/\/+$/, '');
    const url = `${baseUrl}/api/v5/${path}?apiKey=${RETAILCRM_API_KEY}`;

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
async function postRetailCrm(path: string, rootKey: string, data: any) {
    const baseUrl = RETAILCRM_URL!.replace(/\/+$/, '');
    const url = `${baseUrl}/api/v5/${path}?apiKey=${RETAILCRM_API_KEY}`;
    
    const body = new URLSearchParams();
    body.append(rootKey, JSON.stringify(data));

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
    const baseUrl = RETAILCRM_URL!.replace(/\/+$/, '');
    const url = `${baseUrl}/api/v5/customers?apiKey=${RETAILCRM_API_KEY}&filter[name]=${phone}`;
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
        const customerResult = await postRetailCrm('customers/create', 'customer', {
            firstName: params.name || 'Клиент из чата',
            phones: params.phone ? [{ number: params.phone }] : [],
            email: params.email
        });
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

    const managerComment = `[Лид из ИИ-чата]
${telegramStr}
Клиент смотрел страницы: ${visitedPagesStr}
Город: ${cityStr}

-- Краткая суть разговора (Summary от ИИ): --
${params.query_summary}

-- Лог диалога: --
${historyLog}
`;

    // 2. Create Order/Lead
    const orderData: any = {
        status: 'new',
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

    // Site mapping based on domain
    if (params.domain && params.domain.includes('.')) {
        // orderData.site = params.domain; // Removed to prevent 400 errors if site code mismatch
    }

    // Add items as comments or actual items if they exist in CRM catalog
    if (params.items && params.items.length > 0) {
        orderData.customerComment += `\nИнтересовался товарами: ${params.items.join(', ')}`;
    }

    const orderResult = await postRetailCrm('orders/create', 'order', orderData);
    
    if (!orderResult.success) {
        console.error('Failed to create order:', orderResult);
        throw new Error(`CRM Order Creation Failed: ${JSON.stringify(orderResult.errors)}`);
    }

    return orderResult;
}
