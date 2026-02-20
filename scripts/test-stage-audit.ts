import dotenv from 'dotenv';
import path from 'path';
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

import { collectStageEvidence } from '../lib/stage-collector';
import { evaluateStageChecklist } from '../lib/quality-control';

async function test() {
    console.log('🧪 Starting Stage Audit Test...');

    const testOrderId = 42768;
    const testStatus = 'kvalifikatsiya'; // Example status
    const testStart = '2024-01-01T00:00:00Z'; // Far past

    console.log(`📦 Collecting evidence for Order #${testOrderId}, Status: ${testStatus}...`);
    const evidence = await collectStageEvidence(testOrderId, testStatus, testStart);

    console.log(`📊 Collected ${evidence.interactions.length} interactions.`);
    evidence.interactions.forEach(i => {
        console.log(`- [${i.type}] ${i.timestamp}: ${i.content.substring(0, 50)}...`);
    });

    if (evidence.interactions.length === 0) {
        console.warn('⚠️ No evidence found. Test might be inconclusive.');
    }

    const testChecklist = [
        {
            section: "Первичный контакт",
            items: [
                { description: "Поприветствовать клиента", weight: 20 },
                { description: "Выяснить ЛПР", weight: 30 }
            ]
        }
    ];

    console.log('🤖 Running AI Audit...');
    const result = await evaluateStageChecklist(evidence, testChecklist);

    console.log('\n✅ AUDIT RESULT:');
    console.log(`Score: ${result.totalScore} / ${result.maxScore}`);
    console.log(`Summary: ${result.summary}`);
    console.log('\nSections:');
    result.sections.forEach(s => {
        console.log(`- ${s.section} (${s.sectionScore}/${s.sectionMaxScore})`);
        s.items.forEach(i => {
            console.log(`  [${i.status}] ${i.description}: ${i.reasoning}`);
        });
    });
}

test().catch(console.error);
