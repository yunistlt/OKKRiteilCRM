/**
 * Объединение карточек одного юрлица — тем же кодом, что и кнопка в карточке
 * (`lib/own-crm/merge-clients.ts`). Двух реализаций слияния быть не должно.
 *
 * Два режима:
 *   npx tsx scripts/merge-clients.ts --main=66493 --dup=12722,33914 [--apply]
 *   npx tsx scripts/merge-clients.ts --by-inn [--apply]
 *
 * Без `--apply` только показывает, что будет сделано.
 */
import { config } from 'dotenv';

config({ path: '.env.local' });

const arg = (name: string): string | null =>
    process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=')[1] ?? null;

async function cardLine(id: string): Promise<string> {
    const { supabase } = await import('../utils/supabase');
    const { data } = await supabase.from('clients').select('company_name, inn').eq('id', id).maybeSingle();
    const { count } = await supabase.from('orders').select('id', { count: 'exact', head: true }).filter('customer->>id', 'eq', id);
    return `№${id} «${(data as any)?.company_name ?? 'без названия'}» (заказов ${count ?? 0}, ИНН ${(data as any)?.inn ?? '—'})`;
}

/** Пары «главная — дубль» по совпадающему ИНН: главной берём ту, где больше заказов. */
async function pairsByInn(): Promise<Array<{ main: string; dup: string }>> {
    const { supabase } = await import('../utils/supabase');
    const { data } = await supabase.from('clients').select('id, inn').is('merged_into', null).not('inn', 'is', null);

    const byInn = new Map<string, string[]>();
    for (const row of ((data ?? []) as any[])) {
        const inn = String(row.inn ?? '').trim();
        if (!inn) continue;
        byInn.set(inn, [...(byInn.get(inn) ?? []), String(row.id)]);
    }

    const pairs: Array<{ main: string; dup: string }> = [];
    for (const [, ids] of byInn) {
        if (ids.length < 2) continue;
        const counts = await Promise.all(ids.map(async (id) => {
            const { count } = await supabase.from('orders').select('id', { count: 'exact', head: true }).filter('customer->>id', 'eq', id);
            return { id, orders: Number(count ?? 0) };
        }));
        counts.sort((a, b) => b.orders - a.orders || Number(a.id) - Number(b.id));
        for (const dup of counts.slice(1)) pairs.push({ main: counts[0].id, dup: dup.id });
    }
    return pairs;
}

async function main() {
    const apply = process.argv.includes('--apply');
    const { mergeClients } = await import('../lib/own-crm/merge-clients');

    let pairs: Array<{ main: string; dup: string }>;
    if (process.argv.includes('--by-inn')) {
        pairs = await pairsByInn();
    } else {
        const mainId = arg('main');
        const dups = (arg('dup') ?? '').split(',').map((s) => s.trim()).filter(Boolean);
        if (!mainId || !dups.length) {
            console.error('Нужно --main=<id> и --dup=<id,id,…>, либо --by-inn');
            process.exit(1);
        }
        pairs = dups.map((dup) => ({ main: mainId, dup }));
    }

    if (!pairs.length) {
        console.log('Дублей не нашлось.');
        return;
    }

    for (const { main: mainId, dup } of pairs) {
        console.log(`\n${await cardLine(dup)}\n  → ${await cardLine(mainId)}`);
        if (!apply) continue;
        try {
            const r = await mergeClients(mainId, dup, 'слияние карточек (скрипт)');
            console.log(`  объединено: заказов ${r.movedOrders}, контактных лиц ${r.movedContacts}`);
        } catch (e: any) {
            console.log(`  не вышло: ${e.message}`);
        }
    }

    if (!apply) console.log('\nЭто пробный прогон. Повторите с --apply.');
}

main();
