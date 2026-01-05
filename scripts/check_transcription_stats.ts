import { supabase } from './utils/supabase';

async function checkStats() {
    console.log('--- 📊 Статистика Транскрибации ---\n');

    // 1. Всего сматченных звонков
    const { count: totalMatched } = await supabase
        .from('calls')
        .select('*', { count: 'exact', head: true })
        .not('matches', 'is', null);

    // 2. Обработано (есть transcript)
    const { count: processed } = await supabase
        .from('calls')
        .select('*', { count: 'exact', head: true })
        .not('transcript', 'is', null);

    // 3. Ожидают обработки (transcript = null)
    const { count: waiting } = await supabase
        .from('calls')
        .select('*', { count: 'exact', head: true })
        .is('transcript', null)
        .not('matches', 'is', null);

    console.log(`✅ Всего сматченных звонков: ${totalMatched}`);
    console.log(`🎯 Обработано (есть транскрипт): ${processed}`);
    console.log(`⏳ Ожидают обработки: ${waiting}`);

    if (processed && totalMatched) {
        const percent = Math.round((processed / totalMatched) * 100);
        console.log(`📈 Прогресс: ${percent}%\n`);
    }

    // 4. Последние 10 звонков и их статус
    const { data: recentCalls } = await supabase
        .from('calls')
        .select('id, timestamp, transcript, is_answering_machine')
        .not('matches', 'is', null)
        .order('timestamp', { ascending: false })
        .limit(10);

    console.log('--- 🕐 Последние 10 сматченных звонков ---');
    recentCalls?.forEach(c => {
        const status = c.transcript ? '✅ Готово' : '⏳ В очереди';
        const date = new Date(c.timestamp).toLocaleString('ru-RU');
        console.log(`ID ${c.id} | ${date} | ${status}`);
    });

    // 5. Самый свежий обработанный звонок
    const { data: lastProcessed } = await supabase
        .from('calls')
        .select('id, timestamp')
        .not('transcript', 'is', null)
        .order('timestamp', { ascending: false })
        .limit(1)
        .single();

    if (lastProcessed) {
        const lastDate = new Date(lastProcessed.timestamp).toLocaleString('ru-RU');
        console.log(`\n🔥 Последний обработанный звонок: ID ${lastProcessed.id} от ${lastDate}`);
    }
}

checkStats().catch(console.error);
