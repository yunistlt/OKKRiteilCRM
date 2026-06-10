const postgres = require('postgres');
require('dotenv').config({ path: '.env.local' });
const sql = postgres(process.env.DATABASE_URL, { ssl: 'require' });
const HARDCODED = ['short_call','call_impersonation','missed_incoming','answering_machine_dialog','no_comment_on_status_change','fake_qualification','illegal_cancel_from_new','timer_reset_attempt','order_dragging','critical_status_overdue'];
(async () => {
  try {
    // какие вообще колонки
    const cols = await sql`SELECT column_name FROM information_schema.columns WHERE table_name='okk_rules' ORDER BY ordinal_position`;
    console.log('Колонки okk_rules:', cols.map(c=>c.column_name).join(', '));
    const rules = await sql`SELECT * FROM okk_rules ORDER BY is_active DESC, code`;
    console.log(`\nВсего правил: ${rules.length}\n`);
    const classify = (r) => {
      const hasLogic = r.logic != null && JSON.stringify(r.logic) !== '{}' && JSON.stringify(r.logic) !== 'null';
      const hasChecklist = r.checklist != null && Array.isArray(r.checklist) ? r.checklist.length>0 : (r.checklist && JSON.stringify(r.checklist)!=='[]');
      const hasSql = r.condition_sql && r.condition_sql.trim().length>0;
      const hard = HARDCODED.includes(r.code);
      if (hasLogic) return 'logic';
      if (hasChecklist) return 'checklist';
      if (hard) return 'hardcoded';
      if (hasSql) return 'sql?';
      return 'STUB';
    };
    const rows = rules.map(r => ({
      code: r.code, active: r.is_active, type: r.rule_type, method: classify(r),
      checklist_n: Array.isArray(r.checklist)? r.checklist.length : 0,
      prompt: !!r.semantic_prompt, name: (r.name||'').slice(0,40)
    }));
    // сводка
    const summ = {};
    for (const r of rows) { const k = (r.active?'ON ':'off ')+r.method; summ[k]=(summ[k]||0)+1; }
    console.log('Сводка [статус метод]:', summ);
    console.log('\n=== АКТИВНЫЕ ПРАВИЛА ===');
    for (const r of rows.filter(r=>r.active)) console.log(`  [${r.method.padEnd(9)}] ${r.code.padEnd(34)} chk=${r.checklist_n} prompt=${r.prompt?'y':'n'} | ${r.name}`);
    console.log('\n=== АКТИВНЫЕ ЗАГЛУШКИ (нет пути оценки) ===');
    const stubs = rows.filter(r=>r.active && r.method==='STUB');
    if (!stubs.length) console.log('  нет');
    for (const r of stubs) console.log(`  ${r.code} | ${r.name} | type=${r.type} prompt=${r.prompt?'y':'n'}`);
  } catch(e){console.error('ОШИБКА:',e.message);process.exitCode=1;} finally{await sql.end();}
})();
