import postgres from 'postgres';
import fs from 'fs';

// Let's configure environment variables since we are running outside Next.js context but using files that import supabase utility
// Wait, the supabase helper from @utils/supabase uses environment variables from process.env.
// Let's set them up.
const env = fs.readFileSync('.env.local','utf8');
env.split('\n').forEach(line => {
  const parts = line.match(/^([^=]+)=(.*)$/);
  if (parts) {
    const k = parts[1].trim();
    const v = parts[2].trim().replace(/^["']|["']$/g,'');
    process.env[k] = v;
  }
});

import('../lib/salary/engine.ts').then(async (m) => {
  try {
    console.log("Starting recalculation for July 2026...");
    const res = await m.recalcAndPersist(2026, 7, 'manual-trigger-agent');
    console.log("Recalculation complete! Results:", JSON.stringify(res, null, 2));
  } catch (e) {
    console.error("Recalculation failed with error:", e);
  }
  process.exit(0);
}).catch(err => {
  console.error("Failed to load engine:", err);
  process.exit(1);
});
