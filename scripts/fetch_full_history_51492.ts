
import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://lywtzgntmibdpgoijbty.supabase.co';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

const supabase = createClient(supabaseUrl, supabaseKey);

async function fetchFullHistory(orderId: number) {
    console.log(`\n=== ПОЛНАЯ ИСТОРИЯ ЗАКАЗА #${orderId} ===\n`);

    // 1. Основная информация
    const { data: order } = await supabase.from('orders').select('*').eq('id', orderId).single();
    console.log(`[ОСНОВНОЕ]`);
    console.log(`Статус: ${order?.status}`);
    console.log(`Сумма: ${order?.totalsumm} руб.`);
    console.log(`Менеджер ID: ${order?.manager_id}`);
    console.log(`------------------------------------------\n`);

    // 2. События и коммуникации (RetailCRM + Emails/Messages)
    const { data: events } = await supabase
        .from('raw_order_events')
        .select('*')
        .eq('retailcrm_order_id', orderId)
        .order('occurred_at', { ascending: true });

    console.log(`[ХРОНОЛОГИЯ СОБЫТИЙ И ПЕРЕПИСКА]`);
    if (events && events.length > 0) {
        events.forEach((e: any) => {
            const time = new Date(e.occurred_at).toLocaleString('ru-RU');
            const type = e.event_type;
            const payload = e.raw_payload || {};

            let details = '';
            if (type.includes('comment') || type.includes('message')) {
                details = payload.text || payload.newValue || payload.value || JSON.stringify(payload);
            } else if (payload.oldValue !== undefined && payload.newValue !== undefined) {
                details = `${payload.oldValue} -> ${payload.newValue}`;
            }

            console.log(`[${time}] ${type}: ${details}`);
        });
    } else {
        console.log('Событий не найдено.');
    }
    console.log(`------------------------------------------\n`);

    // 3. Звонки
    const { data: matchedCalls } = await supabase
        .from('call_order_matches')
        .select('raw_telphin_calls(*)')
        .eq('retailcrm_order_id', orderId);

    console.log(`[ЗВОНКИ]`);
    if (matchedCalls && matchedCalls.length > 0) {
        matchedCalls.forEach((m: any) => {
            const call = m.raw_telphin_calls;
            const time = new Date(call.started_at).toLocaleString('ru-RU');
            console.log(`[${time}] ${call.direction === 'in' ? 'Входящий' : 'Исходящий'} (${call.duration_sec} сек.)`);
            if (call.transcript) {
                console.log(`Транскрипт: "${call.transcript}"`);
            } else {
                console.log('Транскрипт отсутствует.');
            }
        });
    } else {
        console.log('Звонков не найдено.');
    }
    console.log(`------------------------------------------\n`);

    // 4. Аналитика Анны
    const { data: metrics } = await supabase
        .from('order_metrics')
        .select('*')
        .eq('retailcrm_order_id', orderId)
        .single();

    console.log(`[АНАЛИЗ АННЫ]`);
    if (metrics?.insights) {
        console.log(`Резюме: ${metrics.insights.summary}`);
        if (metrics.insights.recommendations) {
            console.log(`Рекомендации: ${metrics.insights.recommendations.join(', ')}`);
        }
    } else {
        console.log('Анализ еще не проводился или данных недостаточно.');
    }
    console.log(`------------------------------------------\n`);

    // 5. Логи ИИ-роутинга (Решения Максима)
    const { data: routingLogs } = await supabase
        .from('ai_routing_logs')
        .select('*')
        .eq('order_id', orderId)
        .order('created_at', { ascending: true });

    console.log(`[РЕШЕНИЯ МАКСИМА (ИИ-РОУТИНГ)]`);
    if (routingLogs && routingLogs.length > 0) {
        routingLogs.forEach((log: any) => {
            const time = new Date(log.created_at).toLocaleString('ru-RU');
            console.log(`[${time}] Решение: ${log.to_status} (Уверенность: ${log.confidence * 100}%)`);
            console.log(`Обоснование: ${log.ai_reasoning}`);
            console.log(`Применено: ${log.was_applied ? 'Да' : 'Нет'}`);
            console.log('---');
        });
    } else {
        console.log('Решений не зафиксировано.');
    }
    console.log(`\n=== КОНЕЦ ОТЧЕТА ===\n`);
}

const orderId = parseInt(process.argv[2] || '51492');
fetchFullHistory(orderId);
