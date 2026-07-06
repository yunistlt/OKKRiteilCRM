const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://lywtzgntmibdpgoijbty.supabase.co';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
const supabase = createClient(supabaseUrl, supabaseKey);

async function check() {
  console.log('--- Диагностика сессий с has_contacts = true, но без заполненных полей контактов ---');

  const { data: sessions, error } = await supabase
    .from('widget_sessions')
    .select('id, nickname, created_at, has_contacts, is_lead_created, crm_order_number')
    .eq('has_contacts', true)
    .order('created_at', { ascending: false })
    .limit(4);

  if (error) {
    console.error('Ошибка получения сессий:', error);
    return;
  }

  if (!sessions || sessions.length === 0) {
    console.log('Нет таких сессий.');
    return;
  }

  console.log(`Найдено сессий: ${sessions.length}\n`);

  for (const s of sessions) {
    console.log(`Сессия ID: ${s.id}`);
    console.log(`Никнейм: ${s.nickname}`);
    console.log(`Создана: ${s.created_at}`);
    console.log(`Флаг is_lead_created: ${s.is_lead_created}`);
    console.log(`Заказ в CRM: ${s.crm_order_number}`);

    // Получаем сообщения этой сессии
    const { data: messages, error: mErr } = await supabase
      .from('widget_messages')
      .select('role, content, created_at')
      .eq('session_id', s.id)
      .order('created_at', { ascending: true });

    if (mErr) {
      console.error('Ошибка получения сообщений:', mErr);
      continue;
    }

    console.log('История диалога:');
    if (!messages || messages.length === 0) {
      console.log('  [Нет сообщений]');
    } else {
      messages.forEach(m => {
        console.log(`  [${m.role}] ${m.content}`);
      });
    }
    console.log('-----------------------------------------------------\n');
  }
}

check();
