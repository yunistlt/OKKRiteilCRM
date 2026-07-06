require('dotenv').config({ path: '.env.local' });
const { Client } = require('pg');
(async () => {
  const c = new Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();
  const r = await c.query(
    `SELECT email_type, status, created_crm_order_number, forwarded_to, confidence, left(reasoning,140) reasoning
     FROM incoming_emails WHERE subject ILIKE '%ШСО 4В%' ORDER BY received_at DESC LIMIT 1`);
  console.log(JSON.stringify(r.rows[0], null, 1));
  await c.end();
})().catch(e => { console.error(e.message); process.exit(1); });
