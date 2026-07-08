const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

async function check() {
  const { data, error } = await supabase
    .from('ai_prompts')
    .select('key, is_active, system_prompt')
    .eq('key', 'email_secretary_classifier')
    .maybeSingle();

  if (error) {
    console.error('Error fetching prompt:', error);
    return;
  }

  console.log('Prompt status:', data ? { key: data.key, is_active: data.is_active } : 'Not found');
  if (data) {
    console.log('--- PROMPT ---');
    console.log(data.system_prompt);
  }
}

check();
