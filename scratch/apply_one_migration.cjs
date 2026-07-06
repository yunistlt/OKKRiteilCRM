require('dotenv').config({ path: '.env.local' });
const { Client } = require('pg');
const fs = require('fs');
const path = require('path');
(async () => {
  const file = process.argv[2];
  const c = new Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();
  try {
    const sql = fs.readFileSync(path.join(__dirname, '../migrations/', file), 'utf8');
    console.log('Applying', file, '...');
    await c.query(sql);
    console.log('OK');
    const pr = await c.query('SELECT model, input_per_1m, output_per_1m FROM ai_model_pricing ORDER BY model');
    console.table(pr.rows);
    const fx = await c.query('SELECT usd_to_rub FROM ai_cost_settings');
    console.table(fx.rows);
    const ev = await c.query("SELECT count(*)::int n FROM ai_usage_events");
    console.log('ai_usage_events rows:', ev.rows[0].n);
  } catch (e) { console.error('FAIL:', e.message); process.exit(1); }
  finally { await c.end(); }
})();
