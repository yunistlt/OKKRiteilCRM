import { config } from 'dotenv';
config({ path: '.env.local' });
async function main() {
    const { runMorning } = await import('@/lib/sales-rop/service');
    const res = await runMorning('2026-08-31', { dryRun: true });
    console.log('менеджеров:', res.managers, '| задач:', res.tasks, '\n');
    for (const m of res.preview) {
        const lines = m.replace(/<a href="[^"]*">([^<]*)<\/a>/g, '$1').split('\n');
        console.log(lines[0], '|', lines.find((l) => l.includes('на сегодня')) ?? '');
        for (const l of lines) if (/^[🔴🟠🟡🔵⚪️⚫️🟢📅]/.test(l)) console.log('   ', l);
    }
}
main().catch((e) => { console.error(e); process.exit(1); });
