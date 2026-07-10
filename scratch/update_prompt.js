const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: '.env.local' });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

async function run() {
  const sqlFile = path.join(__dirname, '../migrations/20260708_update_katerina_prompt_corporate.sql');
  const sqlContent = fs.readFileSync(sqlFile, 'utf8');

  // Extract prompt content between $prompt$ delimiters
  const match = sqlContent.match(/\$prompt\$([\s\S]*?)\$prompt\$/);
  if (!match) {
    console.error('Could not parse system prompt from SQL file');
    process.exit(1);
  }
  const prompt = match[1].trim();

  console.log('Updating system_prompt in DB...');
  const { data, error } = await supabase
    .from('ai_prompts')
    .update({
      system_prompt: prompt,
      updated_at: new Date().toISOString()
    })
    .eq('key', 'email_secretary_classifier')
    .select();

  if (error) {
    console.error('Error updating prompt:', error);
    process.exit(1);
  }

  console.log('Successfully updated prompt in database!');
  console.log('Updated row:', data);
}

run();
