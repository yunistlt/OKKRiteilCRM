const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://lywtzgntmibdpgoijbty.supabase.co';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
const supabase = createClient(supabaseUrl, supabaseKey);

async function check() {
  const { data, error } = await supabase
    .from('widget_sessions')
    .select('*')
    .limit(1);

  if (error) {
    console.error('Ошибка:', error);
    return;
  }

  console.log('Доступные поля в widget_sessions:');
  console.log(Object.keys(data[0]));
}

check();
