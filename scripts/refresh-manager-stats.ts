/**
 * Пересчитать сводку по менеджеру вручную.
 *
 * Сводка (`dialogue_stats`) — снимок за последние 35 дней, его обновляет крон
 * `manager-aggregate-refresh`. 6–15 октября пятнадцать таких задач упали по
 * таймауту базы (это было до починки обслуживания таблицы заказов 16.10), и
 * по части менеджеров снимок с тех пор не обновлялся.
 *
 * Запуск:
 *   npx tsx scripts/refresh-manager-stats.ts              # все, у кого есть снимок
 *   npx tsx scripts/refresh-manager-stats.ts --ids=10,98  # только эти
 */
import { config } from 'dotenv';
config({ path: '.env.local' });

const arg = (name: string): string | null =>
    process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=').slice(1).join('=') ?? null;

async function main() {
    const { supabase } = await import('../utils/supabase');
    const { refreshManagerDialogueStats } = await import('../lib/manager-aggregates');

    let ids = (arg('ids') || '').split(',').map((s) => s.trim()).filter(Boolean);

    if (!ids.length) {
        const { data } = await supabase.from('dialogue_stats').select('manager_id');
        ids = ((data ?? []) as any[]).map((row) => String(row.manager_id));
    }

    for (const id of ids) {
        const started = Date.now();
        try {
            const result = await refreshManagerDialogueStats(id);
            console.log(
                `менеджер ${id}: ${result.status}`,
                `| совпадений ${result.matchesFound}`,
                `| звонков привязано ${result.callsLinked}`,
                `| ${Date.now() - started} мс`,
            );
        } catch (e: any) {
            console.error(`менеджер ${id}: ОШИБКА — ${e.message}`);
        }
        // Пауза между менеджерами: у базы слабый диск, торопиться некуда.
        await new Promise((resolve) => setTimeout(resolve, 1000));
    }
}

main().catch((e) => { console.error(e.message); process.exit(1); });
