import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { runFullEvaluation } from '../lib/okk-evaluator';

async function main() {
    console.log('🚀 Starting mass evaluation for all active orders...');
    const start = Date.now();

    try {
        const result = await runFullEvaluation({
            // limit: 100 // Uncomment to limit for safety during first run
        });

        const duration = Math.round((Date.now() - start) / 1000);
        console.log('\n✅ Mass evaluation complete!');
        console.log(`📊 Processed: ${result.processed}`);
        console.log(`❌ Errors: ${result.errors}`);
        console.log(`⏱️ Duration: ${duration}s`);
    } catch (e) {
        console.error('💥 Fatal error during mass evaluation:', e);
    }
}

main();
