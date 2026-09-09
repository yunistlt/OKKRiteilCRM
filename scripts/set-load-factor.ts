/**
 * Посмотреть или изменить нагрузку отдела продаж.
 *
 * Без аргументов — показывает текущее значение и что оно даёт.
 * С числом — меняет: npx tsx scripts/set-load-factor.ts 1.10
 * Вернуть как было: npx tsx scripts/set-load-factor.ts 1.00
 */
import { config } from 'dotenv';
config({ path: '.env.local' });

async function main() {
    const value = process.argv[2];
    const { supabase } = await import('../utils/supabase');

    const read = async () => {
        const { data } = await supabase
            .from('sales_rop_settings')
            .select('key, value')
            .in('key', ['load_factor', 'daily_target_tasks', 'tasks_per_manager']);
        return new Map(((data ?? []) as any[]).map((r) => [r.key, r.value]));
    };

    if (value) {
        const factor = Number(value);
        if (!Number.isFinite(factor) || factor < 0.5 || factor > 2) {
            throw new Error('нагрузка задаётся числом от 0.5 до 2.0, например 1.05');
        }
        const { error } = await supabase
            .from('sales_rop_settings')
            .upsert({ key: 'load_factor', value: String(factor) }, { onConflict: 'key' });
        if (error) throw new Error(error.message);
        console.log(`нагрузка установлена: ×${factor}`);
    }

    const map = await read();
    const factor = Number(map.get('load_factor') ?? 1);
    const target = Number(map.get('daily_target_tasks') ?? 12);
    const per = Number(map.get('tasks_per_manager') ?? 7);

    console.log(`\nнагрузка сейчас: ×${factor}`);
    console.log(`норма дня:       ${target} → ${Math.max(1, Math.round(target * factor))} задач`);
    console.log(`наших задач:     ${per} → ${Math.max(1, Math.round(per * factor))} на человека`);
    console.log('\nизменения применятся к утреннему плану следующего дня.');
}

main().catch((e) => {
    console.error(e.message);
    process.exit(1);
});
