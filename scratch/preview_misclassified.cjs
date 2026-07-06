require('dotenv').config({ path: '.env.local' });
const { Client } = require('pg');
(async () => {
  const c = new Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();
  // Сегодняшние письма, застрявшие в 'classified' (действие не выполнялось): кандидаты на переобработку
  const r = await c.query(
    `SELECT email_type, status, count(*) AS n
     FROM incoming_emails
     WHERE received_at >= '2026-06-29 00:00:00+00'
     GROUP BY email_type, status ORDER BY status, email_type`);
  console.log('=== сегодня по типу/статусу ===');
  for (const x of r.rows) console.log(`${String(x.status).padEnd(11)} ${String(x.email_type).padEnd(12)} ${x.n}`);

  const cand = await c.query(
    `SELECT received_at, confidence, left(subject,60) AS subject
     FROM incoming_emails
     WHERE received_at >= '2026-06-29 00:00:00+00'
       AND status='classified' AND email_type='not_request'
     ORDER BY received_at`);
  console.log(`\n=== кандидаты (classified + not_request, сегодня): ${cand.rows.length} ===`);
  for (const x of cand.rows) console.log(`${x.received_at.toISOString()} c=${x.confidence ?? '—'} | ${x.subject}`);
  await c.end();
})().catch(e => { console.error(e.message); process.exit(1); });
