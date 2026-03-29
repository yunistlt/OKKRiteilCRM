
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

        // 2. Получаем историю заказов (используем filter[customerCorporateId] для компаний)
        steps.push('📦 Загрузка истории заказов...');
        const ordersUrl = `${RETAILCRM_URL}/api/v5/orders?apiKey=${RETAILCRM_KEY}&filter[customerCorporateId]=${customer.id}&limit=20`;
        const oRes = await fetch(ordersUrl);

        if (!oRes.ok) {
            const errText = await oRes.text();
            throw new Error(`CRM Orders Error: ${oRes.status} — ${errText.substring(0, 300)}`);
        }

        const oData = await oRes.json();
        const orders = oData.orders || [];
        steps.push(`📊 Найдено реальных заказов: ${orders.length}`);

        // 3. Расширенная аналитика (как в боевом режиме)
        const calculatedLtv = orders.reduce((sum: number, o: any) => sum + (Number(o.totalSumm) || 0), 0);
        const calculatedAvg = orders.length ? calculatedLtv / orders.length : 0;
        
        let ordersPerYear = 0;
        let daysSinceLastOrder = null;
        if (orders.length > 0) {
            const sorted = [...orders].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
            const first = new Date(sorted[0].createdAt);
            const last = new Date(sorted[sorted.length - 1].createdAt);
            const diffYears = (last.getTime() - first.getTime()) / (1000 * 60 * 60 * 24 * 365.25);
            ordersPerYear = diffYears > 0.01 ? Number((orders.length / diffYears).toFixed(1)) : orders.length;
            daysSinceLastOrder = Math.floor((new Date().getTime() - last.getTime()) / (1000 * 60 * 60 * 24));
        }

        // Агрегация товаров
        const productsMap = new Map<string, { count: number }>();
        orders.forEach((o: any) => {
            o.items?.forEach((it: any) => {
                const name = it.offer?.name || it.productName || 'Неизвестный товар';
                const curr = productsMap.get(name) || { count: 0 };
                productsMap.set(name, { count: curr.count + (it.quantity || 1) });
            });
        });
        const products = Array.from(productsMap.entries())
            .map(([name, s]) => ({ name, count: s.count }))
            .sort((a, b) => b.count - a.count);

        // 4. Формируем контекст для ИИ
        const ctx: EmailGenerationContext = {
            company_name: companyName,
            contact_person: contactName !== '—' ? contactName : undefined,
            orders_history: orders.map((o: any) => 
                `Заказ #${o.number} от ${o.createdAt} (${o.status}): ${o.items?.map((i: any) => i.offer?.name || i.productName).join(', ')}`
            ).join('\n') || 'История заказов пуста',
            manager_comments: customer.notes || ''
        };

        // 5. Генерация письма
        steps.push('✍️ Виктория-Писатель формирует письмо...');
        const result = await generateReactivationEmail(ctx);
        steps.push('✅ Письмо успешно сформировано');
        steps.push(`💡 Обоснование ИИ: ${result.reasoning.substring(0, 100)}...`);

        // 6. "Отправка"
        const telegramMessage = `
🧪 <b>СИНТЕТИЧЕСКАЯ ПРОВЕРКА (СИМУЛЯЦИЯ)</b>
<b>Компания:</b> ${companyName} (ID: ${customer.id})
<b>Контакт:</b> ${contactName}
<b>Заказов:</b> ${orders.length}
<b>LTV:</b> ${calculatedLtv.toLocaleString()} ₽
<b>Email:</b> ${testEmail}

<b>ОБОСНОВАНИЕ:</b>
${result.reasoning}

<b>ТЕКСТ:</b>
${result.body}
`;

        steps.push(`📧 Имитация отправки на ${testEmail}...`);
        await sendTelegramNotification(telegramMessage);
        steps.push('📲 Копия отправлена в Telegram бот @OKKzmk');

        return NextResponse.json({
            success: true,
            steps,
            // Данные в формате для LogModal
            details: {
                client: {
                    id: customer.id,
                    name: companyName,
                    inn: customer.inn,
                    site: customer.site,
                    phones: phones,
                    contact_name: contactName !== '—' ? contactName : null,
                    orders_count: orders.length,
                    average_check: calculatedAvg,
                    total_summ: calculatedLtv
                },
                orders: orders.map((o: any) => ({
                    order_id: o.id,
                    number: o.number,
                    totalsumm: o.totalSumm,
                    created_at: o.createdAt
                })),
                products: products,
                analytics: {
                    daysSinceLastOrder,
                    ordersPerYear
                }
            },
            generatedEmail: result.body,
            reasoning: result.reasoning
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
