/**
 * Занести снимок баланса OpenAI (запускать после каждого пополнения счёта).
 * От этого снимка сторож /api/cron/ai-balance-watch считает остаток, вычитая расходы из ai_usage_events.
 *
 * Запуск:  npx tsx scripts/ai-balance-snapshot.ts <остаток_в_USD> ["комментарий"]
 * Пример:  npx tsx scripts/ai-balance-snapshot.ts 50 "пополнил на 50$"
 */
import { supabase } from '../utils/supabase';

async function main() {
    const balanceUsd = Number(process.argv[2]);
    const note = process.argv[3] || null;

    if (!Number.isFinite(balanceUsd) || balanceUsd < 0) {
        console.error('Укажите остаток в USD: npx tsx scripts/ai-balance-snapshot.ts 50 "пополнение"');
        process.exit(1);
    }

    const { error } = await supabase
        .from('ai_balance_snapshots')
        .insert({ balance_usd: balanceUsd, occurred_at: new Date().toISOString(), note });
    if (error) throw error;

    console.log(`Снимок баланса записан: $${balanceUsd}${note ? ` (${note})` : ''}`);
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
