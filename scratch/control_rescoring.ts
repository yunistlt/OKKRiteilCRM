import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import postgres from 'postgres';
import { evaluateScript } from '../lib/okk-evaluator';

const SCRIPT_KEYS = [
    'script_greeting', 'script_call_purpose', 'script_company_info', 'script_lpr_identified',
    'script_budget_confirmed', 'script_urgency_identified', 'script_deadlines', 'script_tz_confirmed',
    'script_objection_general', 'script_objection_delays', 'script_offer_best_tech',
    'script_offer_best_terms', 'script_offer_best_price', 'script_cross_sell',
    'script_next_step_agreed', 'script_dialogue_management', 'script_confident_speech',
];

const sql = postgres(process.env.DATABASE_URL!, { ssl: 'require', max: 3 });

function assembleTranscript(calls: any[]): string {
    return calls
        .filter(c => !!c.transcript)
        .sort((a, b) => new Date(a.started_at).getTime() - new Date(b.started_at).getTime())
        .map(c => {
            const date = new Date(c.started_at).toLocaleString('ru-RU');
            const dir = c.direction === 'outgoing' ? 'ИСХОДЯЩИЙ' : 'ВХОДЯЩИЙ';
            return `--- ${dir} ЗВОНОК (${date}, ${c.duration_sec} сек) ---\n${c.transcript}`;
        })
        .join('\n\n');
}

function fmt(v: any) { return v === true ? '✅' : v === false ? '❌' : v === null ? '🟡null' : String(v); }

async function main() {
    const ids = process.argv.slice(2).map(Number).filter(Boolean);
    // Заказы с транскриптом и сохранённой оценкой скрипта
    const orders = ids.length
        ? await sql<any[]>`
            SELECT s.order_id, s.script_score_pct, s.total_score, s.deal_score_pct, s.score_breakdown
            FROM okk_order_scores s
            WHERE s.order_id = ANY(${ids})
            ORDER BY array_position(${ids}, s.order_id::int)
        `
        : await sql<any[]>`
            SELECT s.order_id, s.script_score_pct, s.total_score, s.deal_score_pct, s.score_breakdown
            FROM okk_order_scores s
            WHERE s.order_id IN (
                SELECT DISTINCT m.retailcrm_order_id
                FROM call_order_matches m
                JOIN raw_telphin_calls c ON c.telphin_call_id = m.telphin_call_id
                WHERE c.transcript IS NOT NULL AND length(c.transcript) > 80
            )
            ORDER BY s.eval_date DESC NULLS LAST
            LIMIT 4
        `;

    console.log(`\nКонтрольный dry-run по ${orders.length} заказам (новый код evaluateScript, без записи в прод)\n`);

    for (const o of orders) {
        const calls = await sql<any[]>`
            SELECT c.started_at, c.duration_sec, c.direction, c.transcript
            FROM call_order_matches m
            JOIN raw_telphin_calls c ON c.telphin_call_id = m.telphin_call_id
            WHERE m.retailcrm_order_id = ${o.order_id} AND c.transcript IS NOT NULL
        `;
        const transcript = assembleTranscript(calls);

        const bd = o.score_breakdown || {};
        const oldVals: Record<string, any> = {};
        for (const k of SCRIPT_KEYS) {
            // что хранится сейчас: result из breakdown (или из колонки если есть)
            oldVals[k] = bd[k]?.result;
        }
        const oldFalse = SCRIPT_KEYS.filter(k => oldVals[k] === false).length;
        const oldNull = SCRIPT_KEYS.filter(k => oldVals[k] === null || oldVals[k] === undefined).length;
        const oldFalseNoData = SCRIPT_KEYS.filter(k => oldVals[k] === false && /нет данных|не учит|оценить нельз/i.test(bd[k]?.reason || '')).length;

        console.log('═'.repeat(70));
        console.log(`Заказ #${o.order_id}  | звонков с транскриптом: ${calls.length}, длина: ${transcript.length}`);
        console.log(`  БЫЛО:  script=${o.script_score_pct ?? '—'}%  total=${o.total_score ?? '—'}%  | false=${oldFalse} (из них "нет данных"=${oldFalseNoData}), null/нет=${oldNull}`);

        const res: any = await evaluateScript(transcript, null);
        const newVals: Record<string, any> = {};
        for (const k of SCRIPT_KEYS) newVals[k] = res[k]?.result;
        const newTrue = SCRIPT_KEYS.filter(k => newVals[k] === true).length;
        const newFalse = SCRIPT_KEYS.filter(k => newVals[k] === false).length;
        const newNull = SCRIPT_KEYS.filter(k => newVals[k] === null).length;

        console.log(`  СТАЛО: script=${res.script_score_pct ?? '—'}%  | ✅=${newTrue} ❌=${newFalse} 🟡null(не учит.)=${newNull}`);
        // показать пункты, которые сменили false→null (раньше штрафовали, теперь не учитываются)
        const flipped = SCRIPT_KEYS.filter(k => oldVals[k] === false && newVals[k] === null);
        if (flipped.length) {
            console.log(`  ↳ false→null (перестали штрафовать): ${flipped.join(', ')}`);
        }
        console.log(`  по пунктам: ${SCRIPT_KEYS.map(k => `${k.replace('script_','')}:${fmt(newVals[k])}`).join('  ')}`);
    }

    await sql.end();
    console.log('\nГотово. Это dry-run — данные в БД не изменены.\n');
}

main().catch(e => { console.error(e); process.exit(1); });
