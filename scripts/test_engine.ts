
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { runRuleEngine } from '../lib/rule-engine';

async function test() {
    console.log('Testing Rule Engine...');
    // Test for Dec 2025
    await runRuleEngine('2025-12-01T00:00:00Z', '2026-01-02T00:00:00Z');
    console.log('Done.');
}

test();
