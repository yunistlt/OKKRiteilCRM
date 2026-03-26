
import { NextResponse } from 'next/server';
import { generateReactivationEmail } from '@/lib/reactivation';
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

        steps.push('👤 Поиск случайного клиента в RetailCRM...');
        
        // Пробуем максимально простой запрос без доп. фильтров для проверки связи
        const customersUrl = `${RETAILCRM_URL}/api/v5/customers?apiKey=${RETAILCRM_KEY}&limit=1`;
        console.log('[Reactivation Test] Fetching customer:', customersUrl.replace(RETAILCRM_KEY, '***'));
        
        const cRes = await fetch(customersUrl);
        if (!cRes.ok) {
            const errText = await cRes.text();
            throw new Error(`CRM API Error customers: ${cRes.status} — ${errText.substring(0, 300)}`);
        }

        const cData = await cRes.json();
        if (!cData.success) {
            throw new Error(`CRM Success False: ${JSON.stringify(cData)}`);
        }

        const customer = cData.customers?.[0];
        if (!customer) {
            throw new Error('Клиенты не найдены в RetailCRM (пустой список)');
        }

        steps.push(`✅ Выбран клиент: ${customer.company || customer.firstName || 'Без имени'} (ID: ${customer.id})`);

        // 2. Получаем историю заказов
        steps.push('📦 Загрузка истории заказов...');
        const ordersUrl = `${RETAILCRM_URL}/api/v5/orders?apiKey=${RETAILCRM_KEY}&filter[customer]=${customer.id}&limit=5`;
        const oRes = await fetch(ordersUrl);

        if (!oRes.ok) {
            const errText = await oRes.text();
            throw new Error(`CRM Orders Error: ${oRes.status} — ${errText.substring(0, 300)}`);
        }

        const oData = await oRes.json();
        const orders = oData.orders || [];
        steps.push(`📊 Найдено заказов: ${orders.length}`);

        // 3. Формируем контекст для ИИ
        const ctx = {
            company_name: customer.company || `${customer.firstName ?? ''} ${customer.lastName ?? ''}`.trim() || `Клиент #${customer.id}`,
            orders_history: orders.map((o: any) => ({
                number: o.number,
                createdAt: o.createdAt,
                status: o.status,
                totalSumm: o.totalSumm,
                items: o.items?.map((i: any) => i.offer?.name || i.productName).join(', ')
            })),
            manager_comments: customer.notes || ''
        };

        // 4. Генерация письма
        steps.push('✍️ Виктория-Писатель формирует письмо...');
        const generatedEmail = await generateReactivationEmail(ctx);
        steps.push('✅ Письмо успешно сформировано');

        // 5. "Отправка" на почту через лог и Telegram (так как прямого SMTP нет)
        const telegramMessage = `
🧪 <b>СИНТЕТИЧЕСКАЯ ПРОВЕРКА ВИКТОРИИ</b>
<b>Клиент:</b> ${ctx.company_name} (ID: ${customer.id})
<b>Тестовый Email:</b> ${testEmail}

<b>ТЕКСТ ПИСЬМА:</b>
-------------------
${generatedEmail}
-------------------
`;

        steps.push(`📧 Имитация отправки на ${testEmail}...`);
        await sendTelegramNotification(telegramMessage);
        steps.push('📲 Копия отправлена в Telegram бот @OKKzmk');

        return NextResponse.json({
            success: true,
            steps,
            customerName: ctx.company_name,
            generatedEmail,
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
