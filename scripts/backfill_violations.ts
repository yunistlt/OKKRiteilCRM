
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { runRuleEngine } from '../lib/rule-engine';

async function backfill() {
    console.log('=== BACKFILLING VIOLATIONS (2024-2026) ===');

    // Split into months to avoid memory issues if any
    const startDate = new Date('2024-01-01T00:00:00Z');
    const endDate = new Date('2026-01-01T00:00:00Z');

    let current = new Date(startDate);

    while (current < endDate) {
        const nextMonth = new Date(current);
        nextMonth.setMonth(current.getMonth() + 1);

        const startStr = current.toISOString();
        const endStr = nextMonth.toISOString();

        console.log(`Processing ${startStr} -> ${endStr}...`);
        await runRuleEngine(startStr, endStr);

        current = nextMonth;
    }

    console.log('=== BACKFILL COMPLETE ===');
}

backfill();
