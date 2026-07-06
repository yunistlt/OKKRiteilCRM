require('dotenv').config({ path: '.env.local' });
const { Client } = require('pg');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
(async () => {
  const deadline = Date.now() + 9 * 60 * 1000;
  let last = '';
  while (Date.now() < deadline) {
    const c = new Client({ connectionString: process.env.DATABASE_URL });
    await c.connect();
    const q = await c.query("SELECT count(*)::int n FROM incoming_emails WHERE status='new'");
    const g = await c.query(
      `SELECT email_type, status, created_crm_order_number, forwarded_department, forwarded_to
       FROM incoming_emails WHERE subject ILIKE '%Газпром%' ORDER BY received_at DESC LIMIT 1`);
    await c.end();
    const row = g.rows[0] || {};
    const line = `queue=${q.rows[0].n} | Газпром: type=${row.email_type} status=${row.status} order=${row.created_crm_order_number||'—'} fwd=${row.forwarded_department||'—'}`;
    if (line !== last) { console.log(new Date().toISOString().slice(11,19), line); last = line; }
    if (row.status === 'processed' || (row.status === 'classified' && row.email_type !== 'not_request')) {
      console.log('>>> Газпром переразобран.'); process.exit(0);
    }
    await sleep(30000);
  }
  console.log('>>> Таймаут ожидания (крон ещё не прошёл).');
})().catch(e => { console.error(e.message); process.exit(1); });
