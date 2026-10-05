/**
 * Перевод заказа другому менеджеру — руками менеджера, с причиной.
 *
 * Решение владельца 05.10.2026: «сделай возможность девочкам самим менять
 * менеджера; это временная фича, нам надо будет отслеживать, почему они
 * переносят, чтобы система сразу назначала правильного менеджера». До этого
 * менеджер писал владельцу в Telegram, а тот переводил руками, и причина
 * оседала в комментарии к заказу («5.10. Дубль Ирины на печь в Луховицы,
 * написала АА, чтоб перевёл») — читать такое правилами нельзя.
 *
 * Поэтому причина обязательна и живёт отдельной строкой журнала: по нему и
 * будем строить правила раздачи.
 *
 * Закон проекта: ни одного заказа без активного менеджера — переводить можно
 * только на работающего человека.
 */
import { supabase } from '@/utils/supabase';
import { editOrder } from './edit-order';

export type TransferResult =
    | { ok: true; toManagerName: string }
    | { ok: false; reason: string };

/** Минимальная длина причины: «надо» и «ок» ничего не объясняют. */
const MIN_REASON = 10;

export async function transferOrderManager(params: {
    orderKey: number;
    toManagerId: number;
    reason: string;
    actor: string | null;
}): Promise<TransferResult> {
    const reason = String(params.reason ?? '').trim();
    if (reason.length < MIN_REASON) {
        return { ok: false, reason: 'Напишите, почему переводите заказ — одним предложением' };
    }

    const { data: manager } = await supabase
        .from('managers')
        .select('id, first_name, last_name, active')
        .eq('id', params.toManagerId)
        .maybeSingle();

    if (!manager) return { ok: false, reason: 'Такого менеджера нет' };
    if ((manager as any).active === false) {
        return { ok: false, reason: 'Этот человек уже не работает — заказ ему передать нельзя' };
    }

    const { data: order } = await supabase
        .from('orders')
        .select('id, order_id, number, manager_id')
        .or(`order_id.eq.${params.orderKey},id.eq.${params.orderKey}`)
        .maybeSingle();

    if (!order) return { ok: false, reason: 'Заказ не найден' };
    if (Number((order as any).manager_id) === Number(params.toManagerId)) {
        return { ok: false, reason: 'Заказ и так на этом менеджере' };
    }

    const result = await editOrder(params.orderKey, { managerId: params.toManagerId });
    if (!result.ok) return { ok: false, reason: result.reason };

    // Запись журнала — после самого перевода: журнал без перевода хуже, чем
    // перевод без журнала, но и молчать о сбое записи нельзя.
    const { error } = await supabase.from('order_manager_transfers').insert({
        order_id: (order as any).order_id ?? (order as any).id,
        order_number: (order as any).number ?? null,
        from_manager_id: (order as any).manager_id ?? null,
        to_manager_id: params.toManagerId,
        reason,
        actor: params.actor,
    });
    if (error) console.error('[перевод заказа] причина не записалась:', error.message);

    const name = [(manager as any).first_name, (manager as any).last_name].filter(Boolean).join(' ')
        || `#${params.toManagerId}`;
    return { ok: true, toManagerName: name };
}
