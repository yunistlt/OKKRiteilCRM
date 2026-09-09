/**
 * Сколько задач получит каждый при разной нагрузке. Ничего не шлёт и не пишет.
 *
 * Запуск: npx tsx scripts/check-load-factor.ts [1.05] [дата]
 */
import { config } from 'dotenv';
config({ path: '.env.local' });

async function main() {
    const args = process.argv.slice(2);
    const factor = Number(args.find((a) => /^[\d.]+$/.test(a) && a.includes('.')) ?? 1.05);
    const day = args.find((a) => /^\d{4}-\d{2}-\d{2}$/.test(a)) || new Date(Date.now() + 4 * 3600_000).toISOString().slice(0, 10);

    const { supabase } = await import('../utils/supabase');
    const { runMorning } = await import('../lib/sales-rop/service');

    const before = await supabase.from('sales_rop_settings').select('value').eq('key', 'load_factor').maybeSingle();
    const original = (before.data as any)?.value ?? null;

    const run = async (value: string) => {
        await supabase.from('sales_rop_settings').upsert({ key: value === '1' ? 'load_factor' : 'load_factor', value });
        const r = await runMorning(day, { dryRun: true });
        return r;
    };

    console.log(`день ${day}\n`);
    for (const value of ['1', String(factor)]) {
        const r = await run(value);
        console.log(`нагрузка ×${value}: менеджеров ${r.managers}, задач всего ${r.tasks}`);
    }

    // Возвращаем настройку ровно в то состояние, в каком она была.
    if (original === null) {
        await supabase.from('sales_rop_settings').delete().eq('key', 'load_factor');
    } else {
        await supabase.from('sales_rop_settings').update({ value: original }).eq('key', 'load_factor');
    }
    console.log('\nнастройка возвращена в исходное:', original ?? 'её не было');
}

main().catch((e) => {
    console.error(e.message);
    process.exit(1);
});
