
const { Client } = require('pg');
require('dotenv').config({ path: '.env.local' });

async function check() {
    const client = new Client({ connectionString: process.env.DATABASE_URL });
    await client.connect();

    console.log('--- Summary ---');
    const countRes = await client.query('SELECT count(*) FROM okk_violations');
    console.log('Violations found so far:', countRes.rows[0].count);

    console.log('\n--- Real Examples ---');
    const res = await client.query("SELECT call_id, checklist_result FROM okk_violations WHERE (checklist_result->>'summary') != 'Error during AI evaluation.' ORDER BY violation_time DESC LIMIT 3");

    if (res.rows.length === 0) {
        console.log('No valid violations found yet.');
    }

    res.rows.forEach((r, i) => {
        console.log(`\nExample ${i + 1} (Call ${r.call_id}):`);
        console.log(`Summary: ${r.checklist_result.summary}`);
        console.log('Missed Checklist Items:');
        let foundMissed = false;
        r.checklist_result.sections.forEach(s => {
            s.items.filter(it => it.score === 0).forEach(it => {
                foundMissed = true;
                console.log(`  [!] ${it.description}`);
                console.log(`      Reasoning: ${it.reasoning}`);
            });
        });
        if (!foundMissed) console.log('  (None - this might be a partial score violation)');
    });
    await client.end();
}
check();
