// Optional post-build hook: re-seed the project knowledge base from docs on deploy.
// Runs ONLY when KB_SEED_ON_BUILD is set and a DB URL is present (e.g. Vercel prod build).
// Never fails the build — any error is logged and swallowed.
const { spawnSync } = require('child_process');

const enabled = process.env.KB_SEED_ON_BUILD === '1' || process.env.KB_SEED_ON_BUILD === 'true';
const hasDb = Boolean(process.env.DATABASE_URL || process.env.POSTGRES_URL);

if (!enabled || !hasDb) {
    console.log(`[kb] Skipping project KB seed (KB_SEED_ON_BUILD=${process.env.KB_SEED_ON_BUILD || 'unset'}, hasDb=${hasDb}).`);
    process.exit(0);
}

console.log('[kb] Seeding project knowledge base from docs...');
const result = spawnSync('npx', ['tsx', 'scripts/seed_project_knowledge_kb.ts'], { stdio: 'inherit' });

if (result.status !== 0) {
    console.warn(`[kb] Project KB seed exited with status ${result.status}; continuing build.`);
}
process.exit(0);
