const { Client } = require('pg');
require('dotenv').config({ path: '.env.local' });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const c = new Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();
  for (let i = 0; i < 20; i++) {
    const r = await c.query(`SELECT parse_status, parse_error FROM legal_enforcement_cases WHERE id=1`);
    const d = await c.query(`SELECT count(*)::int AS всего, count(*) FILTER (WHERE extract_status='completed')::int AS разобрано FROM legal_enforcement_documents WHERE case_id=1`);
    const f = await c.query(`SELECT count(*)::int AS фактов FROM legal_enforcement_field_facts WHERE case_id=1`);
    console.log(new Date().toLocaleTimeString('ru-RU'), 'разбор:', r.rows[0].parse_status, '| документов:', d.rows[0].всего, 'разобрано:', d.rows[0].разобрано, '| фактов:', f.rows[0].фактов);
    if (f.rows[0].фактов > 0) { console.log('ГОТОВО. Замечания разбора:', r.rows[0].parse_error); break; }
    await wait(30000);
  }
  await c.end();
})();
