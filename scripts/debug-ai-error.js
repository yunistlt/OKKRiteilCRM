
require('dotenv').config({ path: '.env.local' });
const { evaluateChecklist } = require('../lib/quality-control');

async function test() {
    console.log('Testing AI Evaluation...');
    try {
        const result = await evaluateChecklist('Привет, это тест.', [
            { section: 'Приветствие', items: [{ description: 'Поздороваться', weight: 10 }] }
        ]);
        console.log('Result:', JSON.stringify(result, null, 2));
    } catch (e) {
        console.error('Test Failed:', e);
    }
}

test();
