require('dotenv').config({ path: '.env.local' });
const { Client } = require('pg');
(async () => {
  const c = new Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();
  const r = await c.query(
    `SELECT id, from_email, subject, email_type, confidence, status,
            created_crm_order_number, forwarded_department, forwarded_to,
            received_at, updated_at, left(reasoning,180) AS reasoning
     FROM incoming_emails
     WHERE subject ILIKE '%Газпром%' OR from_email ILIKE '%gazpromgr%'
     ORDER BY received_at DESC LIMIT 5`);
  console.log('=== Воднева/Газпром ===');
  for (const x of r.rows) console.log(JSON.stringify(x, null, 1));

  const recent = await c.query(
    `SELECT subject, email_type, confidence, status, received_at, updated_at
     FROM incoming_emails ORDER BY updated_at DESC LIMIT 12`);
  console.log('\n=== последние 12 по updated_at ===');
  for (const x of recent.rows) console.log(`${x.updated_at.toISOString()} | ${String(x.email_type).padEnd(12)} c=${x.confidence ?? '—'} ${x.status.padEnd(11)} | ${String(x.subject||'').slice(0,45)}`);
  await c.end();
})().catch(e => { console.error(e.message); process.exit(1); });
