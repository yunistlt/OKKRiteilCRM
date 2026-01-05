
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { supabase } from '../utils/supabase';

async function run() {
    console.log('--- 📊 АНАЛИЗ ОБЪЕМА ТРАНСКРИБАЦИИ ---\n');

    // 1. Суммарная статистика
    const { data: stats, error: statsErr } = await supabase
        .from('raw_telphin_calls')
        .select('transcript')
        .not('transcript', 'is', null);

    if (statsErr) {
        console.error('Ошибка получения статистики:', statsErr);
        return;
    }

    const totalCalls = stats.length;
    const totalChars = stats.reduce((sum, row) => sum + (row.transcript?.length || 0), 0);

    console.log(`✅ Всего обработано звонков: ${totalCalls}`);
    console.log(`📝 Суммарно знаков в транскриптах: ${totalChars.toLocaleString('ru-RU')}`);
    console.log(`📏 Среднее кол-во знаков на звонок: ${Math.round(totalChars / (totalCalls || 1))}\n`);

    // 2. Список последних 20 транскрипций
    console.log('--- 📄 ПОСЛЕДНИЕ ТРАНСКРИПЦИИ ---');
    const { data: list, error: listErr } = await supabase
        .from('raw_telphin_calls')
        .select('started_at, duration_sec, transcript')
        .not('transcript', 'is', null)
        .order('started_at', { ascending: false })
        .limit(20);

    if (listErr) {
        console.error('Ошибка получения списка:', listErr);
        return;
    }

    list?.forEach((row, i) => {
        console.log(`\n[${i + 1}] Дата: ${new Date(row.started_at).toLocaleString('ru-RU')} | Длительность: ${row.duration_sec}с | Знаков: ${row.transcript?.length}`);
        console.log(`Текст: ${row.transcript?.substring(0, 150)}...`);
    });
}

run();
