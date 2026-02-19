
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

console.log('CWD:', process.cwd());
console.log('SUPABASE_URL:', process.env.NEXT_PUBLIC_SUPABASE_URL);
console.log('SERVICE_KEY_LEN:', process.env.SUPABASE_SERVICE_ROLE_KEY?.length);
console.log('SERVICE_KEY_START:', process.env.SUPABASE_SERVICE_ROLE_KEY?.substring(0, 10));

async function runAnalysis() {
    const { runRuleEngine } = await import('../lib/rule-engine');
    console.log('🚀 Starting re-analysis for the last 7 days...');

    const now = new Date();
    const start = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000); // 7 days ago

    console.log(`Time Range: ${start.toISOString()} -> ${now.toISOString()}`);

    try {
        // Run without dry run (so it saves to DB)
        const count = await runRuleEngine(start.toISOString(), now.toISOString());
        console.log(`✅ Analysis complete. Total violations found: ${count}`);
    } catch (error) {
        console.error('❌ Analysis failed:', error);
    }
}

runAnalysis();
