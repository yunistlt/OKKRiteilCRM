require('dotenv').config({ path: '.env.local' });
const { Client } = require('pg');
(async () => {
  const c = new Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();
  const upd = await c.query(
    `UPDATE incoming_emails
        SET status='new', email_type=NULL, confidence=NULL, reasoning=NULL,
            assigned_manager_id=NULL, classified_by=NULL,
            forwarded_department=NULL, forwarded_to=NULL, forwarded_at=NULL, forward_error=NULL,
            error_message=NULL, updated_at=now()
      WHERE received_at >= '2026-06-29 00:00:00+00'
        AND status='classified' AND email_type='not_request'
      RETURNING left(subject,55) AS subject`);
  console.log(`Возвращено в очередь (status=new): ${upd.rowCount}`);
  for (const x of upd.rows) console.log('  • ' + x.subject);
  const q = await c.query("SELECT count(*) n FROM incoming_emails WHERE status='new'");
  console.log('\nВсего сейчас в очереди (status=new):', q.rows[0].n);
  await c.end();
})().catch(e => { console.error(e.message); process.exit(1); });
