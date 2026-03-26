
import { NextResponse } from 'next/server';
import { generateReactivationEmail } from '@/lib/reactivation';
import { sendTelegramNotification } from '@/lib/telegram';
// @ts-ignore
import axios from 'axios';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const RETAILCRM_URL = process.env.RETAILCRM_URL;
const RETAILCRM_KEY = process.env.RETAILCRM_API_KEY;

export async function POST(request: Request) {
    const steps: string[] = [];
    try {
        const body = await request.json();
        const testEmail = body.testEmail || 'yunistgl@gmail.com';
        
        steps.push('🔍 Запуск синтетической проверки Виктории...');
        
        // 1. Получаем случайного клиента из RetailCRM (для теста)
        if (!RETAILCRM_URL || !RETAILCRM_KEY) {
            throw new Error('Конфигурация RetailCRM (URL или API Key) отсутствует в переменных окружения');
        }

        steps.push('👤 Поиск случайного клиента в RetailCRM...');
        const customersRes = await axios.get(`${RETAILCRM_URL}/api/v5/customers`, {
            params: { 
                apiKey: RETAILCRM_KEY,
                limit: 1,
                'filter[ordersCountMin]': 1 // Хотя бы один заказ
            }
        });

        const customer = (customersRes.data as any).customers?.[0];
        if (!customer) {
            throw new Error('Клиенты не найдены в RetailCRM');
        }

        steps.push(`✅ Выбран клиент: ${customer.company || customer.firstName || 'Без имени'} (ID: ${customer.id})`);

        // 2. Получаем историю заказов
        steps.push('📦 Загрузка истории заказов...');
        const ordersRes = await axios.get(`${RETAILCRM_URL}/api/v5/orders`, {
            params: {
                apiKey: RETAILCRM_KEY,
                'filter[customer]': customer.id,
                limit: 5
            }
        });
        const orders = (ordersRes.data as any).orders || [];
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
