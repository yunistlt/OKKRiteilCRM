const { Client } = require('pg');
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: '.env.local' });

(async () => {
    const connectionString = process.env.DATABASE_URL || process.env.POSTGRES_URL;
    if (!connectionString) { console.error('no DATABASE_URL'); process.exit(1); }
    const client = new Client({ connectionString });
    await client.connect();
    try {
        const sqlPath = path.join(__dirname, '../migrations/20260629_email_routing.sql');
        const sql = fs.readFileSync(sqlPath, 'utf8');
        console.log('Applying 20260629_email_routing.sql ...');
        await client.query(sql);
        console.log('OK. Migration applied.');

        const routes = await client.query('SELECT department, label, email, is_active FROM email_intake_routes ORDER BY department');
        console.table(routes.rows);
        const cfg = await client.query('SELECT create_orders, forward_enabled, balance_window_days FROM email_intake_config');
        console.table(cfg.rows);
        const prompt = await client.query("SELECT key, (metadata->>'version') AS version, length(system_prompt) AS prompt_len FROM ai_prompts WHERE key='email_secretary_classifier'");
        console.table(prompt.rows);
    } catch (e) {
        console.error('Migration failed:', e.message);
        process.exit(1);
    } finally {
        await client.end();
    }
})();
