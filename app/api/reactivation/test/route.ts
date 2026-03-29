
import { NextResponse } from 'next/server';
import { generateReactivationEmail, EmailGenerationContext } from '@/lib/reactivation';
import { sendTelegramNotification } from '@/lib/telegram';
import { supabase } from '@/utils/supabase';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const RETAILCRM_URL = (process.env.RETAILCRM_URL || process.env.RETAILCRM_BASE_URL || '').replace(/\/+$/, '');

export async function POST(request: Request) {
    const steps: string[] = [];
    try {
        const body = await request.json();
        const testEmail = body.testEmail || 'yunistgl@gmail.com';
        
        steps.push('🔍 Запуск синтетической проверки Виктории (Mode: Database-First)...');
        
        // 1. Выбираем случайного корпоративного клиента из нашей базы
        steps.push('👤 Поиск подходящего корпоративного клиента в БД Supabase...');
        
        const { data: clients, error: clientErr } = await supabase
            .from('clients')
            .select('*')
            .in('contragent_type', ['Юридическое лицо', 'Индивидуальный предприниматель'])
            .gt('orders_count', 0)
            .limit(50);
            
        if (clientErr || !clients || clients.length === 0) {
            throw new Error(`Ошибка поиска клиентов в БД: ${clientErr?.message || 'Клиенты с заказами не найдены'}`);
        }
        
        // Берём случайного из пула
        const client = clients[Math.floor(Math.random() * clients.length)];
        const customerId = client.id;
        
        const companyName = client.company_name || `Компания #${customerId}`;
        const contactName = client.contact_name || '—';
        const phones = client.phones?.join(', ') || '—';
        
        steps.push(`✅ Выбран клиент: ${companyName} (ID: ${customerId})`);
        if (contactName !== '—') steps.push(`👤 Контактное лицо: ${contactName}`);

        // 2. Получаем историю заказов из Supabase
        steps.push('📦 Загрузка истории заказов из БД...');
        const { data: dbOrders, error: ordersErr } = await supabase
            .from('orders')
            .select('order_id, number, totalsumm, created_at, raw_payload')
            .eq('client_id', customerId)
            .order('created_at', { ascending: false })
            .limit(20);
            
        if (ordersErr) throw new Error(`Ошибка загрузки заказов: ${ordersErr.message}`);
        
        const orders = dbOrders || [];
        steps.push(`📊 Найдено заказов в истории: ${orders.length}`);

        // 3. Расширенная аналитика (честная симуляция того, что видит ИИ-Агент)
        const calculatedLtv = Number(client.total_summ) || orders.reduce((sum, o) => sum + (Number(o.totalsumm) || 0), 0);
        const calculatedAvg = Number(client.average_check) || (orders.length ? calculatedLtv / orders.length : 0);
        
        let ordersPerYear = Number(client.orders_count || orders.length) / 2; // Примерная частота из БД
        let daysSinceLastOrder = null;
        
        if (orders.length > 0) {
            const sorted = [...orders].sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
            const first = new Date(sorted[0].created_at);
            const last = new Date(sorted[sorted.length - 1].created_at);
            
            const diffYears = (last.getTime() - first.getTime()) / (1000 * 60 * 60 * 24 * 365.25);
            ordersPerYear = diffYears > 0.05 ? Number((orders.length / diffYears).toFixed(1)) : orders.length;
            daysSinceLastOrder = Math.floor((new Date().getTime() - last.getTime()) / (1000 * 60 * 60 * 24));
        }

        // Агрегация товаров для AI промпта
        const productsMap = new Map<string, { count: number }>();
        orders.forEach((o: any) => {
            const payload = o.raw_payload;
            payload?.items?.forEach((it: any) => {
                const name = it.offer?.name || it.productName || 'Неизвестный товар';
                const curr = productsMap.get(name) || { count: 0 };
                productsMap.set(name, { count: curr.count + (it.quantity || 1) });
            });
        });
        
        const products = Array.from(productsMap.entries())
            .map(([name, s]) => ({ name, count: s.count }))
            .sort((a, b) => b.count - a.count);

        // 4. Формируем контекст для ИИ (Victoria Prompt Context)
        const ctx: EmailGenerationContext = {
            company_name: companyName,
            contact_person: contactName !== '—' ? contactName : undefined,
            orders_history: orders.map((o, i) => {
                const items = (o.raw_payload as any)?.items?.map((it: any) => it.offer?.name || it.productName).join(', ') || '—';
                return `${i + 1}. #${o.number} | ${items} | ${o.totalsumm} ₽`;
            }).join('\n') || 'История заказов пуста',
            manager_comments: client.notes || 'Комментарии менеджера отсутствуют'
        };

        // 5. Генерация письма
        steps.push('✍️ Виктория-Писатель формирует письмо на основе данных БД...');
        const result = await generateReactivationEmail(ctx);
        steps.push('✅ Письмо успешно сформировано');
        steps.push(`💡 Обоснование ИИ: ${result.reasoning.substring(0, 100)}...`);

        // 6. Имитация отправки
        const telegramMessage = `
🧪 <b>СИНТЕТИЧЕСКАЯ ПРОВЕРКА (DATABASE MODE)</b>
<b>Компания:</b> ${companyName} (ID: ${customerId})
<b>Контакт:</b> ${contactName}
<b>Заказов в БД:</b> ${orders.length}
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
            details: {
                client: {
                    id: customerId,
                    name: companyName,
                    inn: client.inn,
                    site: client.site,
                    phones: phones,
                    contact_name: contactName !== '—' ? contactName : null,
                    orders_count: client.orders_count || orders.length,
                    average_check: calculatedAvg,
                    total_summ: calculatedLtv
                },
                orders: orders.map(o => ({
                    order_id: o.order_id,
                    number: o.number,
                    totalsumm: o.totalsumm,
                    created_at: o.created_at
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
