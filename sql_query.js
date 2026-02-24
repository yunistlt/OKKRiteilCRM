const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
require('dotenv').config({path: '.env.local'});
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
async function run() {
  const { data, error } = await supabase.rpc('execute_sql', {
        query: `
        CREATE TABLE IF NOT EXISTS public.okk_violations (
            id SERIAL PRIMARY KEY,
            order_id INTEGER NOT NULL REFERENCES orders(order_id) ON DELETE CASCADE,
            manager_id INTEGER REFERENCES managers(id) ON DELETE SET NULL,
            rule_id TEXT REFERENCES okk_rules(code) ON DELETE SET NULL,
            description TEXT NOT NULL,
            penalty_points INTEGER DEFAULT 0,
            status_from TEXT,
            status_to TEXT,
            created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
            is_fixed BOOLEAN DEFAULT false
        );
        -- Insert a dummy rule for demonstration
        INSERT INTO public.okk_rules (code, name, description, entity_type, rule_type, points, is_active, severity, logic)
        VALUES ('rule_demo_contact', 'Контроль контактных данных', 'Перевод в статус Заявка квалифицирована без контактов', 'order', 'sql', 20, false, 'high', '{}'::jsonb) 
        ON CONFLICT (code) DO NOTHING;
        `
  });
  console.log("Migration result:", error || "Success");
}
run();
