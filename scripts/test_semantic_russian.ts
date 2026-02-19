
import dotenv from 'dotenv';
import path from 'path';

// Set dummy API key to bypass OpenAI constructor check
process.env.OPENAI_API_KEY = 'dummy-key-for-testing';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

async function testSemantic() {
    console.log('Testing Semantic Analysis for Russian Language...');

    // Dynamic import to ensure env var is set before module load
    const { analyzeText } = await import('../lib/semantic');

    // 1. Test "Text too short" case (does not call API)
    console.log('\n--- Case 1: Short Text ---');
    const resultShort = await analyzeText('h', 'rule');
    // console.log('Result:', JSON.stringify(resultShort, null, 2));

    if (resultShort.reasoning === 'Текст слишком короткий для анализа') {
        console.log('✅ Short text message is localized.');
    } else {
        console.error('❌ Short text message is NOT localized:', resultShort.reasoning);
        process.exit(1);
    }

    // 2. Test API Error case (Invalid Key will cause 401 or similar)
    console.log('\n--- Case 2: API Error (Invalid Key) ---');
    // We expect an error caught inside analyzeText and returning our localized message
    const resultError = await analyzeText('Some long text to trigger API call', 'Some rule');
    // console.log('Result:', JSON.stringify(resultError, null, 2));

    if (resultError.reasoning === 'Ошибка во время AI анализа. Проверьте логи.') {
        console.log('✅ Error message is localized.');
    } else {
        console.error('❌ Error message is NOT localized:', resultError.reasoning);
        process.exit(1);
    }
}

testSemantic();
