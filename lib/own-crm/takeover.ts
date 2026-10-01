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
 * Вернуть заказы под RetailCRM можно: снимаем флаг — и синхронизация снова
 * начинает их обновлять. Механика обратима.
 *
 * Теряется при возврате другое: всё, что менеджер наработал у нас за это время.
 * Правки наружу не уходили, поэтому первый же снимок из RetailCRM перезапишет
 * состав, комментарии и статус версией, которая лежит там. Оплаты из нашего
 * журнала в RetailCRM тоже не появятся, а заказы, заведённые у нас (номер с
 * буквой «А»), там не возникнут — их в RetailCRM нет вовсе.
 */
export const TAKEOVER_ROLLBACK_NOTE =
    'Вернуть заказы под RetailCRM можно — снять переключатель, и синхронизация снова начнёт их обновлять. '
    + 'Но то, что менеджер наработает у нас за это время, при возврате затрётся версией из RetailCRM: '
    + 'правки наружу не уходят. Заказы, заведённые у нас (номер с буквой «А»), в RetailCRM не появятся.';

/** Вернуть заказы менеджера под RetailCRM: снимаем флаг «наш». */
export async function returnManagerOrders(managerId: number): Promise<number> {
    let returned = 0;

    for (;;) {
        const { data, error } = await supabase
            .from('orders')
            .select('id')
            .eq('manager_id', managerId)
            .eq('is_own', true)
            // Заказы, заведённые у нас, не возвращаем: в RetailCRM их нет,
            // и сверка удалённых тут же пометила бы их удалёнными.
            .lt('id', 900_000_000)
            .limit(1000);

        if (error) throw new Error(error.message);
        const ids = ((data ?? []) as any[]).map((r) => Number(r.id));
        if (!ids.length) break;

        const { error: e } = await supabase.from('orders').update({ is_own: false }).in('id', ids);
        if (e) throw new Error(e.message);
        returned += ids.length;
    }

    return returned;
}
