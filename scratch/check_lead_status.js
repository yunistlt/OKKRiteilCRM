
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function check() {
  console.log('--- Диагностика лида +79276127124 ---');
  
  // 1. Ищем сообщение
  const { data: messages, error: mErr } = await supabase
    .from('widget_messages')
    .select('*')
    .ilike('content', '%9276127124%')
    .order('created_at', {ascending: false});

  if (!messages || messages.length === 0) {
    console.log('❌ Сообщение с номером не найдено в базе данных.');
    return;
  }
  
  console.log('✅ Сообщение найдено. ID сессии:', messages[0].session_id);

  // 2. Проверяем статус звонка
  const { data: callbacks } = await supabase
    .from('widget_callback_requests')
    .select('*')
    .eq('phone', '79276127124')
    .order('created_at', {ascending: false});

  if (callbacks && callbacks.length > 0) {
    console.log('✅ Запрос на обратный звонок (Telphin) создан. Статус:', callbacks[0].status);
  } else {
    console.log('⚠️ Запрос на звонок не найден. Возможно, сработала защита от дублей.');
  }

  // 3. Проверяем статус обработки Семёном
  const { data: session } = await supabase
    .from('widget_sessions')
    .select('*')
    .eq('id', messages[0].session_id)
    .single();

  if (session) {
    console.log('--- Статус Семёна (Lead Catcher) ---');
    if (session.processed_at) {
      console.log('✅ Семён обработал сессию в:', session.processed_at);
      console.log('🔗 Должен быть создан заказ в RetailCRM.');
    } else {
      console.log('⏳ Семён еще не заходил в эту сессию. (Он сканирует раз в 10 минут).');
      console.log('💡 Если хотите, я могу запустить Семёна принудительно прямо сейчас!');
    }
  }
}

check();
