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

// ── Переезд всего отдела одним действием ────────────────────────────────────

export type StaffTakeoverRow = {
    managerId: number;
    name: string;
    /** Живых заказов в RetailCRM и у нас. */
    orders: number;
    /** Сколько уже наши. */
    own: number;
    /** Есть ли у человека вход в ОКК: без него работать здесь физически нельзя. */
    hasAccount: boolean;
    /** Переведём ли его этим действием. */
    willTake: boolean;
    /** Если не переведём — почему, человеческим языком. */
    skip: string | null;
};

/**
 * Кого затронет переезд всего отдела — показываем до нажатия.
 *
 * Решение владельца 02.10.2026: 04.10.2026 своя CRM включается всем
 * сотрудникам, и нужно одно действие вместо галочки на каждого. Но «все» —
 * это люди, а в справочнике RetailCRM активны ещё и служебные записи
 * («Инженеры ЗМК», «Поддержка», администратор). Поэтому: берём активных, у
 * кого есть заказы и есть вход в ОКК; остальных показываем с причиной, почему
 * пропускаем, — закон «любое число раскладывается».
 */
export async function takeoverEveryonePreview(): Promise<StaffTakeoverRow[]> {
    const { data: managers, error } = await supabase
        .from('managers')
        .select('id, first_name, last_name, own_crm')
        .eq('active', true);
    if (error) throw new Error(error.message);

    const ids = ((managers ?? []) as any[]).map((row) => Number(row.id));
    if (!ids.length) return [];

    const { data: accounts } = await supabase
        .from('users')
        .select('retail_crm_manager_id')
        .in('retail_crm_manager_id', ids);
    const withAccount = new Set(((accounts ?? []) as any[]).map((row) => Number(row.retail_crm_manager_id)));

    const rows: StaffTakeoverRow[] = [];
    for (const manager of (managers ?? []) as any[]) {
        const id = Number(manager.id);
        const counts = await takeoverPreview(id);
        const name = [manager.last_name, manager.first_name].filter(Boolean).join(' ').trim() || `Менеджер ${id}`;
        const hasAccount = withAccount.has(id);

        let skip: string | null = null;
        if (manager.own_crm) skip = 'уже работает в нашей CRM';
        else if (counts.total === 0) skip = 'нет заказов — переводить нечего';
        else if (!hasAccount) skip = 'нет входа в ОКК — сначала создайте доступ, иначе работать будет негде';

        rows.push({
            managerId: id,
            name,
            orders: counts.total,
            own: counts.own,
            hasAccount,
            willTake: !skip,
            skip,
        });
    }

    return rows.sort((left, right) => right.orders - left.orders);
}

/**
 * Перевести весь отдел одним действием: ставим флаг и забираем заказы тем,
 * кого показал предпросмотр. Кого пропускаем — там и остаётся.
 */
export async function takeoverEveryone(): Promise<{ moved: Array<{ name: string; orders: number }>; skipped: Array<{ name: string; reason: string }> }> {
    const plan = await takeoverEveryonePreview();

    const moved: Array<{ name: string; orders: number }> = [];
    for (const row of plan.filter((candidate) => candidate.willTake)) {
        const { error } = await supabase.from('managers').update({ own_crm: true }).eq('id', row.managerId);
        if (error) throw new Error(`${row.name}: ${error.message}`);

        const result = await takeoverManagerOrders(row.managerId);
        moved.push({ name: row.name, orders: result.taken });
    }

    return {
        moved,
        skipped: plan.filter((row) => row.skip).map((row) => ({ name: row.name, reason: row.skip as string })),
    };
}
