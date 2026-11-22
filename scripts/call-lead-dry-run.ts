/**
 * Пробный прогон ИИ-РОПа «заказ по звонку» по прошлым звонкам.
 * Ничего не пишет и заказов не заводит — печатает, что сделал бы.
 *
 *   npx tsx --env-file=.env.local scripts/call-lead-dry-run.ts [дней=14] [out.json]
 */
import { writeFileSync } from 'fs';
import { findCandidateCalls, loadCallLeadSettings, reviewCall, type CallDecision } from '@/lib/sales-rop/call-lead';

async function main() {
    const days = Number(process.argv[2] || 14);
    const out = process.argv[3];
    const settings = await loadCallLeadSettings();
    const calls = await findCandidateCalls({ ...settings, lookbackHours: days * 24 }, new Date(), 1000);

    const decisions: Array<CallDecision & { transcript: string; durationSec: number }> = [];
    for (const call of calls) {
        const d = await reviewCall(call, { dryRun: true, waitMinutes: settings.waitMinutes });
        decisions.push({ ...d, transcript: call.transcript.slice(0, 700), durationSec: call.durationSec });
        process.stderr.write(d.decision === 'created' ? '+' : d.decision === 'error' ? '!' : '.');
    }
    process.stderr.write('\n');

    const by: Record<string, number> = {};
    for (const d of decisions) {
        const k = `${d.decision}:${d.category}`;
        by[k] = (by[k] || 0) + 1;
    }
    console.log(JSON.stringify({ calls: calls.length, by }, null, 1));
    if (out) writeFileSync(out, JSON.stringify(decisions, null, 1));
}

main().catch((e) => { console.error(e); process.exit(1); });
