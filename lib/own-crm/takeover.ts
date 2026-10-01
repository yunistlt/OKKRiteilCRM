/**
 * Переезд менеджера: его заказы становятся нашими.
 *
 * Решение владельца 01.10.2026. Менеджер работает только в нашей CRM — и по
 * новым заявкам, и по старым заказам RetailCRM: заявки у нас живут месяцами и
 * годами, а «новые здесь, старые там» означало бы работу в двух системах.
 *
 * Что значит «наш заказ» после переезда, ровно три вещи:
 *  1. правки идут только в нашу базу и наружу не отправляются;
 *  2. данные из RetailCRM по нему больше не принимаются — синхронизация такие
 *     заказы не перезаписывает (`upsert_orders_v2`, условие `is_own`);
 *  3. сверка удалённых их не трогает — в RetailCRM их «нет» по определению.
 *
 * Цена решения, которую надо знать: в RetailCRM эти заказы застывают на дне
 * переезда. Коллеги, сайт и цех увидят там старую картину — поэтому в цех
 * заказы передают руками.
 */
import { supabase } from '@/utils/supabase';

export type TakeoverResult = {
    /** Сколько заказов забрали. */
    taken: number;
    /** Сколько уже было нашими до этого. */
    already: number;
};

/** Сколько заказов заберём, если переведём менеджера. Для вопроса человеку до действия. */
export async function takeoverPreview(managerId: number): Promise<{ total: number; own: number }> {
    const [{ count: total }, { count: own }] = await Promise.all([
        supabase
            .from('orders')
            .select('id', { count: 'exact', head: true })
            .eq('manager_id', managerId)
            .is('crm_deleted_at', null),
        supabase
            .from('orders')
            .select('id', { count: 'exact', head: true })
            .eq('manager_id', managerId)
            .eq('is_own', true),
    ]);

    return { total: Number(total ?? 0), own: Number(own ?? 0) };
}

/**
 * Забрать заказы менеджера.
 *
 * Берём все его заказы, кроме удалённых в RetailCRM: мёртвые тащить незачем.
 * Пачками по тысяче — иначе запрос не доживает до конца на их объёме.
 */
export async function takeoverManagerOrders(managerId: number): Promise<TakeoverResult> {
    const before = await takeoverPreview(managerId);

    let taken = 0;
    for (;;) {
        const { data, error } = await supabase
            .from('orders')
            .select('id')
            .eq('manager_id', managerId)
            .eq('is_own', false)
            .is('crm_deleted_at', null)
            .limit(1000);

        if (error) throw new Error(error.message);
        const ids = ((data ?? []) as any[]).map((r) => Number(r.id));
        if (!ids.length) break;

        const { error: e } = await supabase.from('orders').update({ is_own: true }).in('id', ids);
        if (e) throw new Error(e.message);
        taken += ids.length;
    }

    return { taken, already: before.own };
}

/**
 * Вернуть заказы в RetailCRM одним движением нельзя: пока они были нашими,
 * правки наружу не уходили, и в RetailCRM лежит версия на день переезда.
 * Поэтому снятие флага у менеджера оставляет его заказы нашими, а новые заявки
 * снова пойдут в RetailCRM. Текст — чтобы сказать это человеку в интерфейсе.
 */
export const TAKEOVER_IRREVERSIBLE_NOTE =
    'Заказы, забранные в нашу CRM, остаются нашими даже если выключить переключатель: '
    + 'в RetailCRM по ним лежит версия на день переезда, и вернуть их туда автоматически нельзя. '
    + 'Новые заявки после выключения снова будут создаваться в RetailCRM.';
