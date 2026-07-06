require('dotenv').config({ path: '.env.local' });
const { Client } = require('pg');
(async () => {
  const c = new Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();
  const q = await c.query("SELECT count(*)::int n FROM incoming_emails WHERE status='new'");
  console.log('Осталось в очереди (status=new):', q.rows[0].n, '\n');
  const r = await c.query(
    `SELECT email_type, status, created_crm_order_number AS ord,
            forwarded_department AS dept, forwarded_to AS fwd, left(subject,50) AS subject
     FROM incoming_emails
     WHERE received_at >= '2026-06-29 00:00:00+00'
       AND (created_crm_order_number IS NOT NULL OR forwarded_to IS NOT NULL
            OR status='new'
            OR received_at >= '2026-06-29 02:00:00+00')
     ORDER BY received_at DESC LIMIT 20`);
  for (const x of r.rows) {
    const action = x.ord ? `заказ №${x.ord}` : x.fwd ? `→ ${x.dept} (${x.fwd})` : (x.status==='new'?'в очереди':'—');
    console.log(`${String(x.email_type||'—').padEnd(12)} ${String(x.status).padEnd(10)} ${String(action).padEnd(34)} | ${x.subject}`);
  }
  await c.end();
})().catch(e => { console.error(e.message); process.exit(1); });
