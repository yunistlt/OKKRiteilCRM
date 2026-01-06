
import { runRuleEngine } from '../lib/rule-engine';

async function reprocess() {
    const startDate = '2025-01-01'; // С начала года
    const endDate = new Date().toISOString();

    console.log(`Starting Rule Engine reprocess from ${startDate} to ${endDate}...`);

    try {
        const total = await runRuleEngine(startDate, endDate);
        console.log(`Reprocess finished. Total violations generated/linked: ${total}`);
    } catch (e) {
        console.error('Reprocess failed:', e);
    }
}

reprocess();
