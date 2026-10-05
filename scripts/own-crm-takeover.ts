/**
 * Переезд менеджера в нашу CRM и возврат обратно.
 *
 *   npx tsx --env-file=.env.local scripts/own-crm-takeover.ts --manager 98
 *   npx tsx --env-file=.env.local scripts/own-crm-takeover.ts --manager 98 --return
 *   npx tsx --env-file=.env.local scripts/own-crm-takeover.ts --manager 98 --check
 *
 * То же самое делает тумблер «Наша CRM» в /settings/managers — скрипт нужен,
 * чтобы переключить в назначенный час без человека за экраном.
 */
import { supabase } from '@/utils/supabase';
import { returnManagerOrders, takeoverManagerOrders, takeoverPreview } from '@/lib/own-crm/takeover';

function arg(name: string): string | null {
    const index = process.argv.indexOf(`--${name}`);
    return index >= 0 ? (process.argv[index + 1] ?? '') : null;
}

async function managerName(id: number): Promise<string> {
    const { data } = await supabase.from('managers').select('first_name, last_name').eq('id', id).maybeSingle();
    return [(data as any)?.first_name, (data as any)?.last_name].filter(Boolean).join(' ') || `менеджер ${id}`;
}

async function main() {
    const managerId = Number(arg('manager'));
    if (!Number.isFinite(managerId) || managerId <= 0) {
        throw new Error('Укажите менеджера: --manager <id>');
    }

    const name = await managerName(managerId);
    const before = await takeoverPreview(managerId);

    if (process.argv.includes('--check')) {
        console.log(`${name}: заказов ${before.total.toLocaleString('ru-RU')}, из них наших ${before.own.toLocaleString('ru-RU')}`);
        return;
    }

    if (process.argv.includes('--return')) {
        await supabase.from('managers').update({ own_crm: false }).eq('id', managerId);
        const returned = await returnManagerOrders(managerId);
        console.log(`${name}: вернули под RetailCRM ${returned.toLocaleString('ru-RU')} заказов. Новые заявки снова пойдут в RetailCRM.`);
        return;
    }

    await supabase.from('managers').update({ own_crm: true }).eq('id', managerId);
    const result = await takeoverManagerOrders(managerId);
    const after = await takeoverPreview(managerId);

    console.log(`${name}: переехал в нашу CRM.`);
    console.log(`  забрали заказов: ${result.taken.toLocaleString('ru-RU')}`);
    console.log(`  всего наших у него: ${after.own.toLocaleString('ru-RU')} из ${after.total.toLocaleString('ru-RU')}`);
    console.log('  новые заявки на него создаются у нас, номер с буквой «А»');
    console.log('  данные из RetailCRM по этим заказам больше не принимаются, наружу ничего не уходит');
}

main().catch((e) => {
    console.error('ОШИБКА:', e.message);
    process.exit(1);
});
