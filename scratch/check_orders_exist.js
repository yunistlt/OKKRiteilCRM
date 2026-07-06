const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://lywtzgntmibdpgoijbty.supabase.co';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
const supabase = createClient(supabaseUrl, supabaseKey);

async function check() {
  const ids = [53717, 53684, 53720, 53253, 53592, 53593, 53511];
  console.log('Проверяем ID заказов в таблице orders:', ids);
  
  const { data, error } = await supabase
    .from('orders')
    .select('order_id, id, status, totalsumm, manager_id')
    .in('order_id', ids);

  if (error) {
    console.error('Ошибка:', error);
    return;
  }

  console.log('Результат по order_id:', data);

  const { data: dataById, error: errorById } = await supabase
    .from('orders')
    .select('order_id, id, status, totalsumm, manager_id')
    .in('id', ids);

  if (errorById) {
    console.error('Ошибка по id:', errorById);
    return;
  }

  console.log('Результат по id (PK):', dataById);
}

check();
