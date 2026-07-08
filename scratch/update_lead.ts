import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { readFileSync } from 'fs';

const crmUrl = process.env.RETAILCRM_URL || '';
const crmKey = process.env.RETAILCRM_API_KEY || '';
const crmSite = process.env.RETAILCRM_SITE || '';

function extractLeadContact(body: string) {
    const out: any = {};
    if (!body) return out;

    const forwardedM = body.match(/(?:От|From)\s*:\s*([^<\r\n]+?)\s*<([a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,})>/i);
    if (forwardedM) {
        out.name = forwardedM[1].trim();
        out.email = forwardedM[2].trim().toLowerCase();
    }

    if (!out.email) {
        const emailM = body.match(/(?:e\s*-\s*mail|email|e-mail)\s*[:：]\s*([a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,})/i);
        if (emailM) {
            out.email = emailM[1].toLowerCase();
        } else {
            const emailOldM = body.match(/e-?mail\s*[:：]\s*([a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,})/i);
            if (emailOldM) out.email = emailOldM[1].toLowerCase();
        }
    }

    const phoneM = body.match(/(?:тел(?:ефон)?|phone)\s*[\.:：]?\s*(\+?\d[\d()\-\s]{5,}\d)/i);
    if (phoneM) {
        out.phone = phoneM[1].replace(/[()\-\s]/g, '');
    }

    if (!out.name) {
        const nameM = body.match(/ПОЛУЧАТЕЛЬ\s*[\r\n]+\s*([^\r\n]{1,80})/i)
            || body.match(/ПЛАТЕЛЬЩИК\s*[\r\n]+\s*([^\r\n]{1,80})/i);
        if (nameM) out.name = nameM[1].trim();
    }

    return out;
}

async function postRetailCrm(path: string, rootKey: string, data: any) {
    const isOrderEdit = path.startsWith('orders/') && path.endsWith('/edit');
    const queryParams = new URLSearchParams({
        apiKey: crmKey,
        site: crmSite,
        ...(isOrderEdit ? { by: 'id' } : {})
    });
    const url = `${crmUrl.replace(/\/+$/, '')}/api/v5/${path}?${queryParams.toString()}`;
    const body = new URLSearchParams();
    body.append(rootKey, JSON.stringify(data));
    body.append('site', crmSite);

    const response = await fetch(url, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: body.toString()
    });

    return response.json();
}

async function getOrder(number: string) {
    const url = `${crmUrl.replace(/\/+$/, '')}/api/v5/orders?apiKey=${crmKey}&filter[numbers][]=${number}`;
    const response = await fetch(url);
    const data = await response.json();
    if (data.success && data.orders && data.orders.length > 0) {
        return data.orders[0];
    }
    return null;
}

async function findCustomerByEmail(email: string) {
    const url = `${crmUrl.replace(/\/+$/, '')}/api/v5/customers?apiKey=${crmKey}&filter[email]=${encodeURIComponent(email)}`;
    const response = await fetch(url);
    const data = await response.json();
    if (data.success && data.customers && data.customers.length > 0) {
        return data.customers[0];
    }
    return null;
}

async function findOrCreateCustomer(email: string, phone: string, name: string) {
    if (email) {
        const existing = await findCustomerByEmail(email);
        if (existing) {
            console.log(`Найден существующий клиент в CRM по email: ID ${existing.id}`);
            return existing.id;
        }
    }
    console.log(`Создаем нового клиента в CRM: Name: ${name}, Email: ${email}, Phone: ${phone}`);
    const res = await postRetailCrm('customers/create', 'customer', {
        firstName: name || 'Клиент (переписка)',
        ...(email ? { email } : {}),
        ...(phone ? { phones: [{ number: phone }] } : {}),
    });
    if (res.success) {
        return res.id;
    }
    throw new Error(`Не удалось создать клиента: ${JSON.stringify(res.errors || res)}`);
}

async function main() {
    const { supabase } = await import('../utils/supabase');
    // 1. Поищем последние 50 писем, создавших заказы
    const { data: emails, error } = await supabase
        .from('incoming_emails')
        .select('id, subject, body_text, body_html, created_crm_order_number, from_email, from_name')
        .not('created_crm_order_number', 'is', null)
        .order('received_at', { ascending: false })
        .limit(50);

    if (error) {
        console.error("Error fetching emails:", error);
        return;
    }

    console.log(`Проверяем последние ${emails.length} заказов...`);

    for (const e of emails) {
        const text = e.body_text || '';
        const isFwd = /---\s*Пересылаемое сообщение\s*---|---\s*Forwarded message\s*---/i.test(text) || 
                      /fwd?:/i.test(e.subject || '');
                      
        if (isFwd) {
            const parsed = extractLeadContact(text);
            if (!parsed.email && !parsed.phone) {
                continue; // Не удалось распарсить контакты из пересылаемого письма
            }

            // Получаем заказ из CRM
            const crmOrder = await getOrder(e.created_crm_order_number);
            if (!crmOrder) {
                continue;
            }

            // Проверим, записаны ли данные неверно (например, почта yunistlt@bk.ru вместо клиентской)
            const needsUpdate = crmOrder.email === 'yunistlt@bk.ru' || crmOrder.email === 'yunistlt@yandex.ru' || !crmOrder.phone;
            
            if (needsUpdate) {
                console.log(`\nНайдено пересланное письмо с неверными контактами! Номер заказа: ${e.created_crm_order_number}`);
                console.log(`Извлечено из тела:`, parsed);
                console.log(`Текущие данные заказа в CRM: Email: "${crmOrder.email}", Phone: "${crmOrder.phone}", Name: "${crmOrder.firstName}", CustomerType: "${crmOrder.customer?.type || 'none'}"`);
                console.log(`Обновляем данные...`);

                const isCorporate = crmOrder.customer?.type === 'customer_corporate';
                
                // 1. Находим или создаем правильного клиента в CRM (только для физлиц, чтобы не ломать корпоративного контрагента)
                let customerId = null;
                if (!isCorporate) {
                    try {
                        customerId = await findOrCreateCustomer(parsed.email || '', parsed.phone || '', parsed.name || '');
                    } catch (cErr: any) {
                        console.error(`Ошибка при поиске/создании клиента: ${cErr.message}`);
                    }
                }

                // 2. Обновляем заказ в CRM
                const orderUpdate: any = {
                    id: crmOrder.id,
                    firstName: parsed.name || crmOrder.firstName,
                    ...(parsed.email ? { email: parsed.email } : {}),
                    ...(parsed.phone ? { phone: parsed.phone } : {}),
                };
                if (customerId && !isCorporate) {
                    orderUpdate.customer = { id: customerId };
                }
                const oRes = await postRetailCrm(`orders/${crmOrder.id}/edit`, 'order', orderUpdate);
                console.log(`Обновление заказа в CRM:`, oRes.success ? 'Успешно' : oRes);
            }
        }
    }
}

main().catch(console.error);
