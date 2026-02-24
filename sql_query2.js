const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
require('dotenv').config({path: '.env.local'});
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
async function run() {
  const { data, error } = await supabase.from('okk_rules').select('*').eq('code', 'rule_demo_contact');
  console.log("Check if rule demo exists:", data?.length > 0 ? "Yes" : "No", "Error:", error);
}
run();
