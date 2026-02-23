import { runFullEvaluation } from '../lib/okk-evaluator';
import * as dotenv from 'dotenv';
import path from 'path';

// Load environment variables from .env.local
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

async function main() {
    const limit = process.argv.includes('--limit')
        ? parseInt(process.argv[process.argv.indexOf('--limit') + 1])
        : 5000;

    const onlyMissing = process.argv.includes('--missing');

    console.log('🚀 Starting Full OKK Evaluation...');
    if (onlyMissing) console.log('🔍 Mode: RE-EVALUATE MISSING SCORES ONLY');
    console.log(`📊 Target limit: ${limit} orders`);
    console.log('--------------------------------------------------');

    const startTime = Date.now();

    try {
        const result = await runFullEvaluation({ limit, onlyMissing });

        const duration = ((Date.now() - startTime) / 1000 / 60).toFixed(1);

        console.log('--------------------------------------------------');
        console.log('✅ Evaluation finished!');
        console.log(`⏱️ Duration: ${duration} minutes`);
        console.log(`📦 Processed: ${result.processed}`);
        console.log(`❌ Errors: ${result.errors}`);

        process.exit(0);
    } catch (error) {
        console.error('💥 Fatal error during evaluation:', error);
        process.exit(1);
    }
}

main();
