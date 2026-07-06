const { Client } = require('pg');
require('dotenv').config({ path: '.env.local' });
(async () => {
  const c = new Client({ connectionString: process.env.DATABASE_URL || process.env.POSTGRES_URL });
  await c.connect();
  const deadline = Date.now() + 9*60*1000;
  while (Date.now() < deadline) {
    const r = await c.query("select from_email, from_name, subject, assigned_manager_id, created_crm_order_id, created_crm_order_number, status from incoming_emails where created_crm_order_id is not null order by updated_at desc limit 5");
    if (r.rowCount > 0) {
      console.log('FIRST LIVE ORDER:');
      for (const x of r.rows) console.log(`  order #${x.created_crm_order_number||x.created_crm_order_id} | ${x.from_name||x.from_email} | "${x.subject}" | mgr ${x.assigned_manager_id} | ${x.status}`);
      await c.end(); process.exit(0);
    }
    const t = await c.query("select count(*)::int n, count(*) filter (where status='processed')::int proc, count(*) filter (where status='error')::int err from incoming_emails");
    console.log(`[${new Date().toISOString().slice(11,19)}] writes in db: ${t.rows[0].n} (orders ${t.rows[0].proc}, errors ${t.rows[0].err}) waiting...`);
    await new Promise(r => setTimeout(r, 120000));
  }
  console.log('TIMEOUT: no live request in 9 min (depends on inbox traffic).');
  await c.end();
})().catch(e=>{console.error('watch err:', e.message); process.exit(1)});
