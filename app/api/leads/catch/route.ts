import { NextResponse } from 'next/server';
import { supabase } from '@/utils/supabase';
import { createLeadInCrm } from '@/lib/retailcrm-leads';
import { checkRateLimit } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';

const CORS_HEADERS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
};

export async function OPTIONS() {
    return NextResponse.json({}, { headers: CORS_HEADERS });
}

export async function POST(req: Request) {
    const rateLimitResp = checkRateLimit(req, 'leads-catch', { limit: 5, windowMs: 60_000 }, CORS_HEADERS);
    if (rateLimitResp) return rateLimitResp;

    try {
        const body = await req.json();

        // Honeypot: если поле заполнено — это бот
        if (body._hp && String(body._hp).length > 0) {
            return NextResponse.json({ success: true, lead_id: 'hp' }, { headers: CORS_HEADERS });
        }

        // ── Шаг 1: email + specs → создать запись, вернуть lead_id ──────────
        if (!body.lead_id) {
            const { email, price, specs } = body;

            if (!email || !email.includes('@') || email.length < 5) {
                return NextResponse.json(
                    { success: false, error: 'Некорректный email' },
                    { status: 400, headers: CORS_HEADERS }
                );
            }

            const { data, error } = await supabase
                .from('calculator_leads')
                .insert({
                    email: email.trim().toLowerCase(),
                    price: price || null,
                    specs: specs || null,
                    step: 1,
                })
                .select('id')
                .single();

            if (error) {
                console.error('[leads/catch] Supabase insert error (step 1):', error);
                return NextResponse.json(
                    { success: false, error: 'Ошибка сервера' },
                    { status: 500, headers: CORS_HEADERS }
                );
            }

            return NextResponse.json(
                { success: true, lead_id: data.id },
                { headers: CORS_HEADERS }
            );
        }

        // ── Шаг 2: lead_id + phone + gift → дообогатить + создать лид в CRM ──
        const { lead_id, phone, gift, price, specs } = body;

        if (!phone || phone.length < 16) {
            return NextResponse.json(
                { success: false, error: 'Некорректный номер телефона' },
                { status: 400, headers: CORS_HEADERS }
            );
        }

        // Достаём email из существующей записи
        const { data: existing, error: fetchError } = await supabase
            .from('calculator_leads')
            .select('id, email, specs, price')
            .eq('id', lead_id)
            .single();

        if (fetchError || !existing) {
            return NextResponse.json(
                { success: false, error: 'Лид не найден' },
                { status: 404, headers: CORS_HEADERS }
            );
        }

        const finalSpecs = specs || existing.specs || {};
        const finalPrice = price || existing.price;

        // Обновляем запись в Supabase
        await supabase
            .from('calculator_leads')
            .update({ phone: phone.trim(), gift: gift || null, price: finalPrice, step: 2 })
            .eq('id', lead_id);

        // Формируем комментарий для менеджера
        const categoryName = finalSpecs.category_name || 'Калькулятор';
        const managerComment = `🔥 ЗАЯВКА С ИНТЕРАКТИВНОГО КАЛЬКУЛЯТОРА

📦 КАТЕГОРИЯ: ${categoryName} (ID: ${finalSpecs.category_id || '—'})

⚙️ ВЫБРАННАЯ КОНФИГУРАЦИЯ:
- Объём камеры: ${finalSpecs.volume || '—'} л
- Температура: ${finalSpecs.temp || '—'} °C
- Электросеть: ${finalSpecs.phase || '—'} В

💰 ОРИЕНТИРОВОЧНАЯ ЦЕНА: ${finalPrice ? finalPrice.toLocaleString('ru-RU') + ' руб. (с учётом НДС)' : '—'}

🎁 ЗАФИКСИРОВАННЫЙ ПОДАРОК: ${gift || '—'}
🛠️ ОБЕЩАННЫЙ БОНУС: Бесплатная онлайн-настройка и запуск оборудования на бланке КБ завода`;

        // Создаём лид в RetailCRM
        let crmOrderId: string | null = null;
        try {
            const crmResult = await createLeadInCrm({
                name: 'Клиент',
                phone: phone.trim(),
                email: existing.email,
                query_summary: managerComment,
                items: finalSpecs.category_name ? [finalSpecs.category_name] : [],
            });

            // Добавляем теги через отдельный запрос к orders/edit
            if (crmResult?.id) {
                crmOrderId = String(crmResult.id);
                await tagCrmOrder(crmResult.id, ['Калькулятор', 'СНОЛЕКС', 'Ловец_Лидов_ОКК']);
            }
        } catch (crmError) {
            // Не блокируем ответ клиенту если CRM недоступна
            console.error('[leads/catch] RetailCRM error (step 2):', crmError);
        }

        // Сохраняем CRM ID если создался
        if (crmOrderId) {
            await supabase
                .from('calculator_leads')
                .update({ crm_order_id: crmOrderId })
                .eq('id', lead_id);
        }

        return NextResponse.json({ success: true }, { headers: CORS_HEADERS });

    } catch (err: any) {
        console.error('[leads/catch] Unhandled error:', err);
        return NextResponse.json(
            { success: false, error: 'Внутренняя ошибка сервера' },
            { status: 500, headers: CORS_HEADERS }
        );
    }
}

// Добавить теги к заказу в RetailCRM
async function tagCrmOrder(orderId: number, tags: string[]) {
    try {
        const url = process.env.RETAILCRM_URL || process.env.RETAILCRM_BASE_URL;
        const key = process.env.RETAILCRM_API_KEY;
        const site = process.env.RETAILCRM_SITE;
        if (!url || !key) return;

        const body = new URLSearchParams();
        body.append('order', JSON.stringify({ tags: tags.map(t => ({ name: t })) }));
        if (site) body.append('site', site);

        await fetch(`${url.replace(/\/+$/, '')}/api/v5/orders/${orderId}/edit?apiKey=${key}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: body.toString(),
        });
    } catch (e) {
        console.error('[leads/catch] tagCrmOrder error:', e);
    }
}
