
import { NextResponse } from 'next/server';
import { generateReactivationEmail, EmailGenerationContext } from '@/lib/reactivation';
import { sendTelegramNotification } from '@/lib/telegram';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const RETAILCRM_URL = (process.env.RETAILCRM_URL || process.env.RETAILCRM_BASE_URL || '').replace(/\/+$/, '');
const RETAILCRM_KEY = process.env.RETAILCRM_API_KEY;

export async function POST(request: Request) {
    const steps: string[] = [];
    try {
        const body = await request.json();
        const testEmail = body.testEmail || 'yunistgl@gmail.com';
        
        steps.push('🔍 Запуск синтетической проверки Виктории...');
        
        // 1. Получаем случайного клиента из RetailCRM (для теста)
        if (!RETAILCRM_URL || !RETAILCRM_KEY) {
            throw new Error(`Конфигурация RetailCRM отсутствует. URL: ${RETAILCRM_URL ? 'OK' : 'MISSING'}, Key: ${RETAILCRM_KEY ? 'OK' : 'MISSING'}`);
        }

        steps.push('👤 Поиск случайного корпоративного клиента в RetailCRM...');
        
        // Переходим на эндпоинт для корпоративных клиентов
        const customersUrl = `${RETAILCRM_URL}/api/v5/customers-corporate?apiKey=${RETAILCRM_KEY}&limit=20`;
        console.log('[Reactivation Test] Fetching corporate customer:', customersUrl.replace(RETAILCRM_KEY, '***'));
        
        const cRes = await fetch(customersUrl);
        if (!cRes.ok) {
            const errText = await cRes.text();
            throw new Error(`CRM API Error corporate customers: ${cRes.status} — ${errText.substring(0, 300)}`);
        }

        const cData = await cRes.json();
        if (!cData.success) {
            throw new Error(`CRM Success False: ${JSON.stringify(cData)}`);
        }

        const customer = cData.customersCorporate?.[0];
        if (!customer) {
            throw new Error('Корпоративные клиенты не найдены в RetailCRM (пустой список)');
        }

        // Логика извлечения контактного лица
        const mainContact = customer.mainCustomerContact || (customer.contactPersons && customer.contactPersons[0]);
        const contactName = mainContact ? `${mainContact.firstName ?? ''} ${mainContact.lastName ?? ''}`.trim() : '—';
        const companyName = customer.nickName || customer.legalName || `Компания #${customer.id}`;
        
        // Собираем телефоны (и из компании, и из контакта)
        const phoneSet = new Set<string>();
        customer.phones?.forEach((p: any) => phoneSet.add(p.number));
        mainContact?.phones?.forEach((p: any) => phoneSet.add(p.number));
        const phones = Array.from(phoneSet).join(', ') || '—';
        
        steps.push(`✅ Выбран клиент: ${companyName} (ID: ${customer.id})`);
        if (contactName !== '—') steps.push(`👤 Контактное лицо: ${contactName}`);

        // 2. Получаем историю заказов (для корпоратов фильтр может быть другим, но обычно по customer ID)
        steps.push('📦 Загрузка истории заказов...');
        const ordersUrl = `${RETAILCRM_URL}/api/v5/orders?apiKey=${RETAILCRM_KEY}&filter[customer]=${customer.id}&limit=20`;
        const oRes = await fetch(ordersUrl);

        if (!oRes.ok) {
            const errText = await oRes.text();
            throw new Error(`CRM Orders Error: ${oRes.status} — ${errText.substring(0, 300)}`);
        }

        const oData = await oRes.json();
        const orders = oData.orders || [];
        steps.push(`📊 Найдено заказов в базе: ${orders.length}`);

        // 3. Формируем контекст для ИИ
        const ctx: EmailGenerationContext = {
            company_name: companyName,
            contact_person: contactName !== '—' ? contactName : undefined,
            orders_history: orders.map((o: any) => ({
                number: o.number,
                createdAt: o.createdAt,
                status: o.status,
                totalSumm: o.totalSumm,
                items: o.items?.map((i: any) => i.offer?.name || i.productName).join(', ')
            })).map((o: any) => `Заказ #${o.number} от ${o.createdAt} (${o.status}): ${o.items}`).join('\n') || 'История заказов пуста',
            manager_comments: customer.notes || ''
        };

        // 4. Генерация письма
        steps.push('✍️ Виктория-Писатель формирует письмо...');
        const result = await generateReactivationEmail(ctx);
        steps.push('✅ Письмо успешно сформировано');
        steps.push(`💡 Обоснование ИИ: ${result.reasoning.substring(0, 100)}...`);

        // 5. "Отправка" на почту через лог и Telegram
        const telegramMessage = `
🧪 <b>СИНТЕТИЧЕСКАЯ ПРОВЕРКА ВИКТОРИИ (B2B)</b>
<b>Компания:</b> ${companyName} (ID: ${customer.id})
<b>Сайт:</b> ${customer.site || '—'}
<b>Контакт:</b> ${contactName}
<b>Телефоны:</b> ${phones}
<b>Заказов:</b> ${customer.ordersCount ?? 0}
<b>Средний чек:</b> ${customer.averageSumm ?? 0} ₽
<b>Тестовый Email:</b> ${testEmail}

<b>ОБОСНОВАНИЕ:</b>
${result.reasoning}

<b>ТЕКСТ ПИСЬМА:</b>
-------------------
${result.body}
-------------------
`;

        steps.push(`📧 Имитация отправки на ${testEmail}...`);
        await sendTelegramNotification(telegramMessage);
        steps.push('📲 Копия отправлена в Telegram бот @OKKzmk');

        return NextResponse.json({
            success: true,
            steps,
            customerData: {
                id: customer.id,
                name: companyName,
                site: customer.site || '—',
                phones: phones,
                contactPerson: contactName,
                ordersCount: customer.ordersCount ?? 0,
                averageCheck: customer.averageSumm ?? 0
            },
            generatedEmail: result.body,
            reasoning: result.reasoning,
            message: `Синтетическая проверка завершена. Копия письма отправлена в Telegram.`
        });

    } catch (error: any) {
        console.error('[VictoriaTest] Error:', error);
        return NextResponse.json({
            success: false,
            steps,
            error: error.message || 'Unknown error'
        }, { status: 500 });
    }
}
