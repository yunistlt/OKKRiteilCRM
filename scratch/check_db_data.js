const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://lywtzgntmibdpgoijbty.supabase.co';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
const supabase = createClient(supabaseUrl, supabaseKey);

async function check() {
  const { data, error } = await supabase
    .from('widget_sessions')
    .select('id, nickname, has_contacts, crm_order_number, crm_order_id, contact_phone, contact_email')
    .eq('has_contacts', true)
    .order('created_at', { ascending: false })
    .limit(10);

  if (error) {
    console.error('Ошибка:', error);
    return;
  }

  console.log('Данные в widget_sessions:');
  console.log(JSON.stringify(data, null, 2));
}

check();
