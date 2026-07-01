import { supabase } from '@/utils/supabase';

export async function getCrmConfig() {
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

export async function findCustomerByEmail(email: string) {
    const { url: baseUrl, key: apiKey } = await getCrmConfig();
    const url = `${baseUrl}/api/v5/customers?apiKey=${apiKey}&filter[email]=${encodeURIComponent(email)}`;
    const response = await fetch(url);
    const data = await response.json();
    if (data.success && data.customers && data.customers.length > 0) {
        return data.customers[0];
    }
    return null;
}

/**
 * Создать заявку по входящему ПИСЬМУ (AI-секретарь «Катерина»).
 * Статус «Новая» (novyi-1). Менеджер назначается сразу, если передан.
 * Возвращает id и номер созданного заказа.
 */
export async function createEmailLead(params: {
    email: string;
    name?: string;
    subject?: string;
    bodySnippet?: string;
    attachmentNames?: string[];
    managerId?: number | null;
}): Promise<{ id: number; number: string }> {
    const { site } = await getCrmConfig();

    // 1. Найти или создать клиента по email
    let customerId: number | null = null;
    const existing = params.email ? await findCustomerByEmail(params.email) : null;
    if (existing) {
        customerId = existing.id;
    } else if (params.email) {
        const customerResult = await postRetailCrm('customers/create', 'customer', {
            firstName: params.name || 'Клиент (письмо)',
            email: params.email,
        }, site);
        if (customerResult.success) customerId = customerResult.id;
    }

    const attNames = (params.attachmentNames || []).filter(Boolean);
    const bodyPart = (params.bodySnippet || '').trim()
        || (attNames.length ? 'Тело письма пустое — суть во вложении (прикреплено к заказу).' : 'не распознано — открыть письмо');
    const attLine = attNames.length ? `\n\n📎 Вложения: ${attNames.join(', ')}` : '';
    const comment = `✉️ Заявка принята AI-секретарём (входящее письмо)

📧 Email: ${params.email || 'не определён'}
📨 Тема: ${params.subject || '(без темы)'}

📝 Текст письма:
${bodyPart}${attLine}`;

    const orderData: any = {
        status: 'novyi-1', // всегда «Новая»
        firstName: params.name || 'Клиент',
        email: params.email,
        customerComment: comment,
        source: { source: 'email-secretary' },
    };
    if (customerId) orderData.customer = { id: customerId };
    if (params.managerId) orderData.managerId = params.managerId;

    const orderResult = await postRetailCrm('orders/create', 'order', orderData, site);
    if (!orderResult.success) {
        const errorMessage = orderResult.errors ? JSON.stringify(orderResult.errors) : (orderResult.errorMsg || 'Unknown error');
        throw new Error(`Email lead create failed: ${errorMessage}`);
    }
    const number = (orderResult.order && orderResult.order.number) || orderResult.number || String(orderResult.id);
    return { id: orderResult.id as number, number: String(number) };
}

export async function createLeadInCrm(params: {
    name: string;
    phone?: string;
    email?: string;
    telegram?: string;
    query_summary: string;
    gifts?: string[];
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

    const giftsInfo = params.gifts && params.gifts.length > 0
        ? params.gifts.map(g => {
            if (g === 'free_installation') return '🎁 Бесплатный монтаж + КП на фирменном бланке';
            if (g === 'alice_speaker') return '🎁 Яндекс Станция Алиса Мини';
            return g;
        }).join('\n')
        : 'нет';

    const managerComment = `🔥 НОВЫЙ ЛИД ИЗ ИИ-ЧАТА

📍 ГЕО: ${cityStr}
📱 КОНТАКТЫ: ${telegramStr || params.phone || params.email || 'указаны в карточке'}

🎁 ПОДАРКИ (зафиксировала Елена):
${giftsInfo}

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

/**
 * Создать заявку по входящему звонку (AI-секретарь Телфина).
 * Статус всегда «Новая» (novyi-1). Менеджер назначается сразу, если передан.
 * Возвращает id заказа и его номер (для озвучки клиенту).
 */
export async function createSecretaryLead(params: {
    phone: string;
    name?: string;
    summary?: string;            // распознанная суть запроса (voice_navigator_STT)
    managerId?: number | null;   // выбранный по нагрузке менеджер
}): Promise<{ id: number; number: string }> {
    const { site } = await getCrmConfig();

    // 1. Найти или создать клиента по телефону
    let customerId: number | null = null;
    const existing = params.phone ? await findCustomerByPhone(params.phone) : null;
    if (existing) {
        customerId = existing.id;
    } else if (params.phone) {
        const customerResult = await postRetailCrm('customers/create', 'customer', {
            firstName: params.name || 'Клиент (звонок)',
            phones: [{ number: params.phone }],
        }, site);
        if (customerResult.success) customerId = customerResult.id;
    }

    const comment = `📞 Заявка принята AI-секретарём (входящий звонок)

📱 Телефон: ${params.phone || 'не определён'}

📝 Суть запроса (распознано):
${params.summary?.trim() || 'не распознано — уточнить у клиента'}`;

    const orderData: any = {
        status: 'novyi-1', // всегда «Новая»
        firstName: params.name || 'Клиент',
        phone: params.phone,
        customerComment: comment,
        source: { source: 'telphin-secretary' },
    };
    if (customerId) orderData.customer = { id: customerId };
    if (params.managerId) orderData.managerId = params.managerId;

    const orderResult = await postRetailCrm('orders/create', 'order', orderData, site);
    if (!orderResult.success) {
        const errorMessage = orderResult.errors ? JSON.stringify(orderResult.errors) : (orderResult.errorMsg || 'Unknown error');
        throw new Error(`Secretary order create failed: ${errorMessage}`);
    }

    const number = (orderResult.order && orderResult.order.number) || orderResult.number || String(orderResult.id);
    return { id: orderResult.id as number, number: String(number) };
}
