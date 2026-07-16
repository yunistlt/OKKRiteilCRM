import { supabase } from '@/utils/supabase';
import { fetchRetailCrmOrder } from './orders';

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

export async function findCorporateCustomerInCrm(filter: { email?: string; phone?: string; inn?: string }) {
    const { url: baseUrl, key: apiKey } = await getCrmConfig();
    const filterParams: string[] = [];
    if (filter.inn) {
        filterParams.push(`filter[contragentInn]=${encodeURIComponent(filter.inn)}`);
    } else if (filter.email) {
        filterParams.push(`filter[email]=${encodeURIComponent(filter.email)}`);
    } else if (filter.phone) {
        filterParams.push(`filter[phone]=${encodeURIComponent(filter.phone)}`);
    } else {
        return null;
    }
    
    const url = `${baseUrl}/api/v5/customers-corporate?apiKey=${apiKey}&${filterParams.join('&')}`;
    
    try {
        const response = await fetch(url);
        const data = await response.json();
        if (data.success && data.customersCorporate && data.customersCorporate.length > 0) {
            return data.customersCorporate[0];
        }
    } catch (err) {
        console.error('Failed to find corporate customer in CRM:', err);
    }
    return null;
}

export async function createCorporateCustomerInCrm(details: {
    companyName: string;
    inn?: string | null;
    kpp?: string | null;
    address?: string | null;
    contactName?: string | null;
    contactPhone?: string | null;
    contactEmail?: string | null;
    bank?: string | null;
    bik?: string | null;
    bankAccount?: string | null;
    corrAccount?: string | null;
}, site: string): Promise<number | null> {
    const payload: any = {
        nickName: details.companyName,
        contragent: {
            contragentType: 'legal-entity',
            legalName: details.companyName,
            INN: details.inn || undefined,
            KPP: details.kpp || undefined,
            bank: details.bank || undefined,
            BIK: details.bik || undefined,
            bankAccount: details.bankAccount || undefined,
            corrAccount: details.corrAccount || undefined,
            legalAddress: details.address || undefined
        }
    };

    if (details.contactName || details.contactPhone || details.contactEmail) {
        payload.mainContact = {
            firstName: details.contactName || 'Контактное лицо',
            email: details.contactEmail || undefined,
            phones: details.contactPhone ? [{ number: details.contactPhone }] : []
        };
    }

    if (details.address) {
        payload.addresses = [{ text: details.address }];
    }

    const result = await postRetailCrm('customers-corporate/create', 'customerCorporate', payload, site);
    if (result.success) {
        return result.id;
    } else {
        console.error('Failed to create corporate customer in CRM:', result);
        return null;
    }
}

/**
 * Создать заявку по входящему ПИСЬМУ (AI-секретарь «Катерина»).
 * Статус «Новая» (novyi-1). Менеджер назначается сразу, если передан.
 * Возвращает id и номер созданного заказа.
 */
export async function createEmailLead(params: {
    email: string;
    name?: string;
    phone?: string;
    subject?: string;
    bodySnippet?: string;
    attachmentNames?: string[];
    managerId?: number | null;
    corporateDetails?: {
        isCorporate: boolean;
        companyName?: string | null;
        inn?: string | null;
        kpp?: string | null;
        address?: string | null;
        contactName?: string | null;
        contactPhone?: string | null;
        bank?: string | null;
        bik?: string | null;
        bankAccount?: string | null;
        corrAccount?: string | null;
    } | null;
    attachmentText?: string;
}): Promise<{ id: number; number: string }> {
    const { site } = await getCrmConfig();
    const isCorp = Boolean(params.corporateDetails?.isCorporate);
    let customerId: number | null = null;

    if (isCorp && params.corporateDetails) {
        // 1. Поиск корпоративного клиента
        // а. Сначала в Supabase по ИНН (самый надежный способ)
        if (params.corporateDetails.inn) {
            try {
                const { data } = await supabase
                    .from('clients')
                    .select('id')
                    .eq('inn', params.corporateDetails.inn)
                    .eq('is_corporate', true)
                    .maybeSingle();
                if (data) {
                    customerId = Number(data.id);
                }
            } catch (err) {
                console.error('Error finding corporate customer in Supabase:', err);
            }
        }

        // б. Если не нашли, ищем в CRM по INN, email или телефону
        if (!customerId) {
            const existingCorp = await findCorporateCustomerInCrm({
                inn: params.corporateDetails.inn || undefined,
                email: params.email || undefined,
                phone: params.corporateDetails.contactPhone || params.phone || undefined
            });
            if (existingCorp) {
                customerId = existingCorp.id;
            }
        }

        // в. Если все еще не нашли, создаем нового корпоративного клиента в CRM
        if (!customerId && params.corporateDetails.companyName) {
            customerId = await createCorporateCustomerInCrm({
                companyName: params.corporateDetails.companyName,
                inn: params.corporateDetails.inn,
                kpp: params.corporateDetails.kpp,
                address: params.corporateDetails.address,
                contactName: params.corporateDetails.contactName || params.name,
                contactPhone: params.corporateDetails.contactPhone || params.phone,
                contactEmail: params.email,
                bank: params.corporateDetails.bank,
                bik: params.corporateDetails.bik,
                bankAccount: params.corporateDetails.bankAccount,
                corrAccount: params.corporateDetails.corrAccount
            }, site);
        }
    } else {
        // 1. Найти или создать клиента по email (для webasyst email — реальный клиента, не робот)
        const existing = params.email ? await findCustomerByEmail(params.email) : null;
        if (existing) {
            customerId = existing.id;
        } else if (params.email || params.phone) {
            const customerResult = await postRetailCrm('customers/create', 'customer', {
                firstName: params.name || 'Клиент (письмо)',
                ...(params.email ? { email: params.email } : {}),
                ...(params.phone ? { phones: [{ number: params.phone }] } : {}),
            }, site);
            if (customerResult.success) customerId = customerResult.id;
        }
    }

    // Проверка на дубликат тендера
    let assignedManagerId = params.managerId;
    let duplicateReason = '';
    let duplicateOfNumber: string | null = null;
    
    try {
        const { findTenderDuplicate } = await import('./tender-duplicates');
        const dupResult = await findTenderDuplicate({
            bodyText: params.bodySnippet || '',
            attachmentText: params.attachmentText || '',
            attachmentNames: params.attachmentNames || [],
            deliveryAddress: params.corporateDetails?.address || null
        });

        if (dupResult) {
            assignedManagerId = dupResult.managerId;
            duplicateOfNumber = dupResult.refOrderNumber;
            duplicateReason = `\n\n⚠️ ДУБЛИКАТ ТЕНДЕРА: обнаружен дублирующий запрос на тендер (ранее создан заказ №${dupResult.refOrderNumber}, ответственный менеджер назначен автоматически)`;
        }
    } catch (dupErr) {
        console.error('Error running duplicate check:', dupErr);
    }

    const attNames = (params.attachmentNames || []).filter(Boolean);
    const bodyPart = (params.bodySnippet || '').trim()
        || (attNames.length ? 'Тело письма пустое — суть во вложении (прикреплено к заказу).' : 'не распознано — открыть письмо');
    const attLine = attNames.length ? `\n\n📎 Вложения: ${attNames.join(', ')}` : '';
    const comment = `✉️ Заявка принята AI-секретарём (входящее письмо)
 
📧 Email: ${params.email || 'не определён'}${params.phone ? `\n📱 Телефон: ${params.phone}` : ''}
📨 Тема: ${params.subject || '(без темы)'}
 
📝 Текст письма:
${bodyPart}${attLine}${duplicateReason}`;

    const orderData: any = {
        status: 'novyi-1', // всегда «Новая»
        firstName: params.corporateDetails?.contactName || params.name || 'Клиент',
        customerComment: comment,
        source: { source: 'email-secretary' },
    };
    if (params.email) orderData.email = params.email;
    if (params.phone) orderData.phone = params.phone;
    if (customerId) {
        orderData.customer = { 
            id: customerId,
            ...(isCorp ? { type: 'customer_corporate' } : {})
        };
    }
    if (duplicateOfNumber) {
        orderData.managerComment = `дубль ${duplicateOfNumber}`;
    }
    if (assignedManagerId) orderData.managerId = assignedManagerId;

    const orderResult = await postRetailCrm('orders/create', 'order', orderData, site);
    if (!orderResult.success) {
        const errorMessage = orderResult.errors ? JSON.stringify(orderResult.errors) : (orderResult.errorMsg || 'Unknown error');
        throw new Error(`Email lead create failed: ${errorMessage}`);
    }
    const number = (orderResult.order && orderResult.order.number) || orderResult.number || String(orderResult.id);
    return { id: orderResult.id as number, number: String(number) };
}

// Форматирует найденные в каталоге ЗМК позиции с реальной ценой — для менеджера.
// Цена показывается только менеджеру в комментарии заказа; клиенту в чате она не озвучивается.
export function formatMatchedCatalogProducts(
    products?: Array<{ name: string; price: number; url?: string; category?: string; priceSource?: 'live' | 'cache' }>
): string {
    if (!products || products.length === 0) return '';
    const lines = products
        .filter((p) => p && p.name)
        .map((p, i) => {
            let priceStr: string;
            if (p.price > 0) {
                const note = p.priceSource === 'cache' ? ' (из кэша, сверьте на сайте)' : ' (актуально с сайта)';
                priceStr = `${Math.round(p.price).toLocaleString('ru-RU')} ₽${note}`;
            } else {
                priceStr = 'цена не указана';
            }
            return `${i + 1}. ${p.name} — ${priceStr}${p.url ? ` — ${p.url}` : ''}`;
        });
    if (lines.length === 0) return '';
    return `\n📦 НАЙДЕНО В КАТАЛОГЕ ЗМК (реальная цена — для менеджера; клиенту НЕ озвучена):\n${lines.join('\n')}\n`;
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
    managerId?: number | null;
    matchedCatalogProducts?: Array<{ name: string; price: number; url?: string; category?: string; priceSource?: 'live' | 'cache' }>;
    corporateDetails?: {
        isCorporate: boolean;
        companyName?: string | null;
        inn?: string | null;
        kpp?: string | null;
        address?: string | null;
        contactName?: string | null;
        contactPhone?: string | null;
        bank?: string | null;
        bik?: string | null;
        bankAccount?: string | null;
        corrAccount?: string | null;
    } | null;
    orderMethod?: string;
}) {
    console.log('Creating lead in RetailCRM:', params);
    const isCorp = Boolean(params.corporateDetails?.isCorporate);
    const { site } = await getCrmConfig();

    // 1. Find or Create Customer
    let customerId: number | null = null;
    if (isCorp && params.corporateDetails) {
        // а. Сначала в Supabase по ИНН
        if (params.corporateDetails.inn) {
            try {
                const { data } = await supabase
                    .from('clients')
                    .select('id')
                    .eq('inn', params.corporateDetails.inn)
                    .eq('is_corporate', true)
                    .maybeSingle();
                if (data) {
                    customerId = Number(data.id);
                }
            } catch (err) {
                console.error('Error finding corporate customer in Supabase:', err);
            }
        }
        // б. В CRM по INN, email или телефону
        if (!customerId) {
            const existingCorp = await findCorporateCustomerInCrm({
                inn: params.corporateDetails.inn || undefined,
                email: params.email || undefined,
                phone: params.corporateDetails.contactPhone || params.phone || undefined
            });
            if (existingCorp) {
                customerId = existingCorp.id;
            }
        }
        // в. Создаем нового корпоративного клиента
        if (!customerId && params.corporateDetails.companyName) {
            customerId = await createCorporateCustomerInCrm({
                companyName: params.corporateDetails.companyName,
                inn: params.corporateDetails.inn,
                kpp: params.corporateDetails.kpp,
                address: params.corporateDetails.address,
                contactName: params.corporateDetails.contactName || params.name,
                contactPhone: params.corporateDetails.contactPhone || params.phone,
                contactEmail: params.email,
                bank: params.corporateDetails.bank,
                bik: params.corporateDetails.bik,
                bankAccount: params.corporateDetails.bankAccount,
                corrAccount: params.corporateDetails.corrAccount
            }, site);
        }
    } else {
        const existing = params.phone ? await findCustomerByPhone(params.phone) : null;
        if (existing) {
            customerId = existing.id;
        } else {
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

    const catalogBlock = formatMatchedCatalogProducts(params.matchedCatalogProducts);

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
${catalogBlock}
📜 КРАТКИЙ ЛОГ ДИАЛОГА:
${historyLog.split('\n').slice(-10).join('\n')}
`;

    // 2. Create Order/Lead
    const orderData: any = {
        status: 'novyi-1', // Correct code for "Новый" from dictionary
        orderMethod: params.orderMethod || 'live-chat',
        lastName: 'ИИ-Лид',
        firstName: params.corporateDetails?.contactName || params.name || 'Клиент',
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
        orderData.customer = { 
            id: customerId,
            ...(isCorp ? { type: 'customer_corporate' } : {})
        };
    }

    if (params.managerId) {
        orderData.managerId = params.managerId;
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

export async function updateExistingOrderInCrm(orderId: number, params: {
    status?: string;
    noteText?: string;
    customFields?: Record<string, any>;
    firstName?: string;
    managerId?: number | null;
}, site?: string): Promise<{ success: boolean; errorMsg?: string }> {
    const { url: baseUrl, key: apiKey, site: configSite } = await getCrmConfig();

    // Всё пишем одним вызовом orders/edit (единственный метод, доступный API-ключу).
    // Сводку квалификации (noteText) кладём в managerComment («Комментарий оператора») —
    // отдельный метод orders/notes/create этому ключу недоступен (404), а edit проходит.
    if (!(params.status || params.customFields || params.firstName || params.managerId || params.noteText)) {
        return { success: true };
    }

    // orders/{id}/edit?by=id СТРОГО требует site, которому принадлежит заказ, а НЕ фиксированный
    // RETAILCRM_SITE: при несовпадении RetailCRM отвечает {success:false,errorMsg:"Not found"}.
    // Заказы приходят из разных магазинов (zmktlt-ru-admin, ao-zvto, …), поэтому берём реальный
    // site заказа: передан вызывающим (если заказ уже фетчили) — иначе резолвим GET-запросом.
    let editSite = site;
    if (!editSite) {
        const order = await fetchRetailCrmOrder(orderId).catch(() => null);
        editSite = (order?.site as string | undefined) || configSite;
    }

    const url = `${baseUrl}/api/v5/orders/${orderId}/edit?apiKey=${apiKey}&site=${encodeURIComponent(editSite)}`;
    const body = new URLSearchParams();
    const orderData: any = {};
    if (params.status) orderData.status = params.status;
    if (params.customFields) orderData.customFields = params.customFields;
    if (params.firstName) orderData.firstName = params.firstName;
    if (params.managerId) orderData.managerId = params.managerId;
    if (params.noteText) orderData.managerComment = params.noteText;

    body.append('order', JSON.stringify(orderData));
    body.append('site', editSite);
    body.append('by', 'id');

    const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString()
    });
    const result = await response.json();
    if (!result.success) {
        console.error(`Failed to update order ${orderId}:`, result);
        const errorMsg = result.errorMsg || (result.errors ? JSON.stringify(result.errors) : `HTTP ${response.status}`);
        return { success: false, errorMsg };
    }

    return { success: true };
}
