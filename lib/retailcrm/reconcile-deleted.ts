import { supabase } from '@/utils/supabase';
import { fetchExistingRetailCrmOrderIds } from './orders';

/**
 * Сверка «жив ли заказ в CRM».
 *
 * Заказы удаляют руками — вебхука об этом нет, синк про удаление не знает.
 * Поэтому идём по кругу: каждый прогон берём тех, кого дольше всех не
 * проверяли, и спрашиваем CRM пачками. Порядок сверки — это очередь, а не
 * выборка «подозрительных»: воскресший заказ должен так же тихо вернуться
 * в работу, как удалённый — уйти.
 */
export type ReconcileResult = {
    checked: number;
    markedDeleted: number;
    restored: number;
};

const DEFAULT_BATCH = 2000;

export async function reconcileDeletedOrders(batchSize = DEFAULT_BATCH): Promise<ReconcileResult> {
    const { data, error } = await supabase
        .from('orders')
        .select('order_id, crm_deleted_at')
        .order('crm_checked_at', { ascending: true, nullsFirst: true })
        .limit(batchSize);
    if (error) throw new Error(error.message);

    const rows = (data ?? []) as Array<{ order_id: number; crm_deleted_at: string | null }>;
    if (rows.length === 0) return { checked: 0, markedDeleted: 0, restored: 0 };

    const alive = await fetchExistingRetailCrmOrderIds(rows.map((r) => Number(r.order_id)));

    const toDelete: number[] = [];
    const toRestore: number[] = [];
    for (const r of rows) {
        const id = Number(r.order_id);
        const exists = alive.has(id);
        if (!exists && !r.crm_deleted_at) toDelete.push(id);
        if (exists && r.crm_deleted_at) toRestore.push(id);
    }

    const now = new Date().toISOString();
    if (toDelete.length) {
        const { error: e } = await supabase
            .from('orders')
            .update({ crm_deleted_at: now, crm_checked_at: now })
            .in('order_id', toDelete);
        if (e) throw new Error(e.message);
    }
    if (toRestore.length) {
        const { error: e } = await supabase
            .from('orders')
            .update({ crm_deleted_at: null, crm_checked_at: now })
            .in('order_id', toRestore);
        if (e) throw new Error(e.message);
    }

    // Отметку о проверке ставим всем — иначе очередь встанет на первой же пачке.
    const untouched = rows
        .map((r) => Number(r.order_id))
        .filter((id) => !toDelete.includes(id) && !toRestore.includes(id));
    for (let i = 0; i < untouched.length; i += 500) {
        const { error: e } = await supabase
            .from('orders')
            .update({ crm_checked_at: now })
            .in('order_id', untouched.slice(i, i + 500));
        if (e) throw new Error(e.message);
    }

    return { checked: rows.length, markedDeleted: toDelete.length, restored: toRestore.length };
}
