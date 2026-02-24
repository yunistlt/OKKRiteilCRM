import * as dotenv from 'dotenv';
import * as path from 'path';
dotenv.config({ path: path.resolve(__dirname, '../.env.local') });

async function test() {
    const { runRuleEngine } = await import('../lib/rule-engine');

    // Example order ID that was found to have a reschedule event
    const targetOrderId = 51784;

    // Period covering the event observed in DB
    const startDate = '2026-02-19T00:00:00Z';
    const endDate = '2026-02-22T00:00:00Z';
    const ruleId = 'rule_reschedule_control';

    console.log(`--- RUNNING RULE ENGINE TEST FOR ORDER ${targetOrderId} ---`);
    const trace: string[] = [];

    try {
        const results = await runRuleEngine(startDate, endDate, ruleId, true, null, trace, targetOrderId);

        console.log('\n--- TRACE ---');
        console.log(trace.join('\n'));

        console.log('\n--- RESULTS ---');
        console.log(JSON.stringify(results, null, 2));
    } catch (e) {
        console.error('Test failed with error:', e);
    }
}

test();
