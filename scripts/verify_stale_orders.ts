
import { runRuleEngine } from '../lib/rule-engine';

async function verify() {
    console.log('--- Verifying Stale Orders (State-based) ---');
    const endDate = new Date().toISOString();
    const startDate = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();

    try {
        const count = await runRuleEngine(startDate, endDate, 'rule_stale_order_v2');
        console.log(`\nDONE! Violations found: ${count}`);
    } catch (e) {
        console.error('Error during verification:', e);
    }
}

verify();
