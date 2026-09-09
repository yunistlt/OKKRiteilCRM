import { supabase } from '@/utils/supabase';
import { updateExistingOrderInCrm } from '@/lib/retailcrm/leads';
import { loadSettings } from '@/lib/sales-rop/service';

// Конвейер заявок: ночью — в пул, днём — пачками обратно.
//
// Три правила, которые здесь важнее кода:
//
//   1. Владелец заказа хранится у нас до возврата. Заказ, потерявший менеджера,
//      это потерянный клиент, и восстанавливать владельца задним числом по
//      истории CRM — не тот случай, где можно рисковать.
//   2. Вечером возвращается ВСЁ, что не дошло до менеджера. Ночевать в пуле
//      заказ не должен: утром человек придёт и не найдёт свою заявку.
//   3. Ошибка записи в CRM останавливает конкретный заказ, а не прогон. Половина
//      припаркованных заказов лучше, чем упавший крон и заказы, зависшие в пуле.

export type QueueRow = {
    id: number;
    orderId: number;
    orderNumber: string;
    ownerId: number;
    siteCode: string;
    ordinal: number;
    state: 'parked' | 'released' | 'done' | 'returned' | 'failed';
};

/** Смена ответственного в CRM. Site обязателен: без него orders/edit не найдёт заказ. */
async function setManager(orderId: number, site: string, managerId: number): Promise<{ ok: boolean; error?: string }> {
    try {
        const res = await updateExistingOrderInCrm(orderId, { managerId }, site || undefined);
        return res.success ? { ok: true } : { ok: false, error: res.errorMsg || 'RetailCRM отказал' };
    } catch (e: any) {
        return { ok: false, error: e.message };
    }
}

export type ParkResult = { parked: number; failed: number; skipped: number };

/**
 * Ночная парковка: заказы дневного плана уезжают на пользователя-пул.
 *
 * Паркуется только то, что в плане на день, — а не все заказы менеджера. Иначе
 * клиент, позвонивший по своему заказу, окажется невидимкой для того, кто его
 * ведёт, и это будет стоить дороже любой дисциплины.
 */
export async function parkQueue(planDate: string, opts: { dryRun?: boolean } = {}): Promise<ParkResult> {
    const settings = await loadSettings();
    const result: ParkResult = { parked: 0, failed: 0, skipped: 0 };
    if (!settings.queueEnabled) return result;

    const only = settings.queueManagerIds;
    const { data: tasks, error } = await supabase
        .from('sales_rop_task')
        .select('order_id, order_number, manager_id, weight')
        .eq('plan_date', planDate)
        .order('weight', { ascending: false });
    if (error) throw new Error(error.message);

    const { data: sites } = await supabase.rpc('sales_rop_presale_orders');
    const siteById = new Map<number, string>(((sites ?? []) as any[]).map((r) => [Number(r.order_id), r.site || '']));

    const perManager = new Map<number, number>();

    for (const t of (tasks ?? []) as any[]) {
        const ownerId = t.manager_id === null ? null : Number(t.manager_id);
        // Заказ без менеджера парковать не с кого и некому возвращать.
        if (!ownerId) {
            result.skipped += 1;
            continue;
        }
        if (only.length > 0 && !only.includes(ownerId)) {
            result.skipped += 1;
            continue;
        }
        // Пул не паркует сам у себя.
        if (ownerId === settings.queuePoolManagerId) {
            result.skipped += 1;
            continue;
        }

        const ordinal = (perManager.get(ownerId) ?? 0) + 1;
        perManager.set(ownerId, ordinal);

        const orderId = Number(t.order_id);
        const site = siteById.get(orderId) ?? '';

        if (opts.dryRun) {
            result.parked += 1;
            continue;
        }

        const res = await setManager(orderId, site, settings.queuePoolManagerId);
        await supabase.from('sales_rop_queue').upsert(
            {
                plan_date: planDate,
                order_id: orderId,
                order_number: t.order_number ?? '',
                owner_id: ownerId,
                parked_to_id: settings.queuePoolManagerId,
                site,
                ordinal,
                state: res.ok ? 'parked' : 'failed',
                parked_at: new Date().toISOString(),
                error: res.error ?? null,
            },
            { onConflict: 'plan_date,order_id' },
        );

        if (res.ok) result.parked += 1;
        else result.failed += 1;
    }

    return result;
}

export type ReleaseResult = { released: number; closed: number; failed: number };

/**
 * Кого выдать следующим. Чистая функция — от неё зависит, увидит ли менеджер
 * работу вообще, и проверять её на боевой CRM поздно.
 *
 * Правило: у человека одновременно не больше batch выданных незакрытых заявок.
 * Закрытой считается та, по которой было касание в CRM.
 */
export function nextForOwner(
    rows: Array<{ state: string; ordinal: number }>,
    batchSize: number,
): Array<{ state: string; ordinal: number }> {
    const inWork = rows.filter((r) => r.state === 'released').length;
    const free = Math.max(0, batchSize - inWork);
    return rows
        .filter((r) => r.state === 'parked')
        .sort((a, b) => a.ordinal - b.ordinal)
        .slice(0, free);
}

/**
 * Выдача пачками: пока у менеджера меньше batch выданных и незакрытых заявок,
 * возвращаем ему следующие по очереди.
 *
 * Выданной заявка считается закрытой не по кнопке, а по касанию в CRM: работа
 * видна по комментарию, смене статуса, письму или звонку. Кнопки «я сделал»
 * здесь нет намеренно — она измеряет нажатия, а не работу.
 */
export async function releaseQueue(planDate: string, opts: { dryRun?: boolean } = {}): Promise<ReleaseResult> {
    const settings = await loadSettings();
    const result: ReleaseResult = { released: 0, closed: 0, failed: 0 };
    if (!settings.queueEnabled) return result;

    const { data: rows, error } = await supabase
        .from('sales_rop_queue')
        .select('*')
        .eq('plan_date', planDate)
        .in('state', ['parked', 'released'])
        .order('ordinal');
    if (error) throw new Error(error.message);

    const { data: touchRows } = await supabase.rpc('sales_rop_touches', { p_date: planDate });
    const touched = new Set<number>(((touchRows ?? []) as any[]).map((r) => Number(r.order_id)));

    // Сначала закрываем отработанные — иначе новая пачка не поедет.
    for (const r of (rows ?? []) as any[]) {
        if (r.state === 'released' && touched.has(Number(r.order_id))) {
            if (!opts.dryRun) {
                await supabase
                    .from('sales_rop_queue')
                    .update({ state: 'done', done_at: new Date().toISOString() })
                    .eq('id', r.id);
            }
            r.state = 'done';
            result.closed += 1;
        }
    }

    const byOwner = new Map<number, any[]>();
    for (const r of (rows ?? []) as any[]) {
        const list = byOwner.get(Number(r.owner_id)) ?? [];
        list.push(r);
        byOwner.set(Number(r.owner_id), list);
    }

    for (const [ownerId, list] of Array.from(byOwner.entries())) {
        const next = nextForOwner(list, settings.queueBatchSize) as any[];

        for (const r of next) {
            if (opts.dryRun) {
                result.released += 1;
                continue;
            }
            const res = await setManager(Number(r.order_id), r.site || '', ownerId);
            await supabase
                .from('sales_rop_queue')
                .update({
                    state: res.ok ? 'released' : 'failed',
                    released_at: res.ok ? new Date().toISOString() : null,
                    error: res.error ?? null,
                })
                .eq('id', r.id);
            if (res.ok) result.released += 1;
            else result.failed += 1;
        }
    }

    return result;
}

export type ReturnResult = { returned: number; failed: number };

/** Вечерний возврат: всё, что не дошло до менеджера, уезжает владельцу. */
export async function returnQueue(planDate: string, opts: { dryRun?: boolean } = {}): Promise<ReturnResult> {
    const result: ReturnResult = { returned: 0, failed: 0 };

    const { data: rows, error } = await supabase
        .from('sales_rop_queue')
        .select('*')
        .eq('plan_date', planDate)
        .in('state', ['parked', 'released', 'done']);
    if (error) throw new Error(error.message);

    for (const r of (rows ?? []) as any[]) {
        // Уже отданные менеджеру трогать незачем: он и есть владелец.
        if (r.state !== 'parked') continue;
        if (opts.dryRun) {
            result.returned += 1;
            continue;
        }
        const res = await setManager(Number(r.order_id), r.site || '', Number(r.owner_id));
        await supabase
            .from('sales_rop_queue')
            .update({
                state: res.ok ? 'returned' : 'failed',
                returned_at: res.ok ? new Date().toISOString() : null,
                error: res.error ?? null,
            })
            .eq('id', r.id);
        if (res.ok) result.returned += 1;
        else result.failed += 1;
    }

    return result;
}
