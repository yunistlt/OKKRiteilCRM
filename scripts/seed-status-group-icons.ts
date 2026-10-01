/**
 * Стартовые иконки этапов статусов.
 *
 * Ставим по смыслу названия — чтобы менеджер увидел знакомую картинку сразу, а
 * не пустую колонку. Дальше иконку меняет человек в настройке этапа
 * (/settings/statuses/board, клик по этапу), в код за этим ходить не нужно.
 */
import { supabase } from '@/utils/supabase';

/** Подсказки: кусок названия этапа → код иконки из components/orders/StatusIcon.tsx */
const HINTS: Array<[RegExp, string]> = [
    [/новый|заявк/i, 'lamp'],
    [/согласован/i, 'chat'],
    [/оплат/i, 'payment'],
    [/тендер/i, 'tender'],
    [/выполнен|успешн/i, 'done'],
    [/доставк|отгруз/i, 'delivery'],
    [/маркетинг|рассылк/i, 'marketing'],
    [/отмен|провален/i, 'cancel'],
    [/производств|цех/i, 'production'],
    [/договор/i, 'contract'],
    [/доработк|внедрен|технич/i, 'service'],
    [/перенос|ожидан/i, 'waiting'],
    [/рекламац/i, 'claim'],
    [/клиент|контакт|развитие/i, 'client'],
];

async function main() {
    const { data, error } = await supabase.from('crm_status_groups').select('id, name, icon');
    if (error) throw new Error(error.message);

    for (const group of ((data ?? []) as any[])) {
        if (group.icon) continue;

        const hit = HINTS.find(([pattern]) => pattern.test(group.name || ''));
        const icon = hit ? hit[1] : 'person';

        const { error: e } = await supabase.from('crm_status_groups').update({ icon }).eq('id', group.id);
        if (e) throw new Error(`${group.name}: ${e.message}`);
        console.log(`${group.name} → ${icon}`);
    }
}

main().catch((e) => {
    console.error('ОШИБКА:', e.message);
    process.exit(1);
});
