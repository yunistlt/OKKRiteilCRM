
import { runRuleEngine } from '../lib/rule-engine';

async function test() {
    const now = new Date();
    const start = new Date(now.getTime() - 1 * 60 * 60 * 1000); // 1 hour ago

    console.log(`Manual trigger: ${start.toISOString()} -> ${now.toISOString()}`);
    try {
        const violations = await runRuleEngine(start.toISOString(), now.toISOString());
        console.log('Success! Violations found:', violations);
    } catch (error) {
        console.error('FAILED!', error);
    }
}

test();
