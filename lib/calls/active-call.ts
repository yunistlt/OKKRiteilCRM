/**
 * Звонок, который идёт прямо сейчас.
 *
 * Разделение владельца 05.10.2026: звонок — событие, происходящее сейчас;
 * запись звонка — результат уже произошедшего. Здесь только первое: пока
 * телефон звонит, строка живёт, браузер видит её через Realtime и показывает
 * окно. Как только разговор начался или звонок сорвался — строка гаснет, а всё
 * остальное (запись, расшифровка, оценка) живёт своей жизнью в
 * `raw_telphin_calls`.
 */
import { supabase } from '@/utils/supabase';
import { clientByPhone, existingBinding, ordersByPhone } from '@/lib/call-binding';

/**
 * Короткий номер добавочного: Телфин присылает «12037*120@corp.telphin.ru», а в
 * карточке менеджера записано просто «120».
 */
export function extensionNumber(value: any): string | null {
    const text = String(value ?? '').trim();
    if (!text) return null;
    const afterStar = text.includes('*') ? text.split('*').pop()! : text;
    const digits = afterStar.split('@')[0].replace(/\D/g, '');
    return digits || null;
}

export type RingingCall = {
    callId: string;
    direction?: 'incoming' | 'outgoing';
    fromNumber?: string | null;
    toNumber?: string | null;
    /** Добавочный, на который звонят: по нему понятно, чей это телефон. */
    extension?: string | null;
    startedAt?: string | null;
};

/**
 * Телефон зазвонил: записываем звонок и всё, что о нём уже известно.
 *
 * Кто звонит и по какому заказу выясняем здесь же, за те секунды, пока идёт
 * гудок: привязка (если её уже сделали), иначе карточка клиента по номеру и его
 * заказы. Угадывать заказ не пытаемся — если открытых заказов несколько, в окне
 * будет имя клиента и предложение выбрать заказ.
 */
export async function callIsRinging(call: RingingCall): Promise<void> {
    const callId = String(call.callId).toUpperCase();
    const direction = call.direction ?? 'incoming';
    const clientPhone = direction === 'incoming' ? call.fromNumber : call.toNumber;

    const [bound, who] = await Promise.all([
        existingBinding(callId),
        clientPhone ? clientByPhone(clientPhone) : Promise.resolve(null),
    ]);

    let orderId: number | null = bound?.orderId ?? null;
    let orderNumber: string | null = null;
    let managerId: number | null = null;

    /**
     * Чей это телефон. Окно показываем хозяину добавочного, а не всем подряд
     * (решение владельца 05.10.2026). Добавочный, который не принадлежит
     * никому, — это очередь: там телефон звонит у нескольких сразу, и окно
     * видят все.
     */
    const ext = extensionNumber(call.extension);
    let isQueue = false;
    if (ext) {
        const { data: owner } = await supabase
            .from('managers')
            .select('id')
            .eq('telphin_extension', ext)
            .limit(1);
        isQueue = !((owner ?? []) as any[]).length;
    }

    // Заказа ещё нет — смотрим, нет ли у клиента единственного открытого: тогда
    // менеджер сразу увидит, по чему звонят.
    if (!orderId && clientPhone) {
        const orders = await ordersByPhone(clientPhone, 20);
        if (orders.length === 1) orderId = orders[0].orderId;
    }

    if (orderId) {
        const { data } = await supabase
            .from('orders')
            .select('number, manager_id')
            .eq('id', orderId)
            .maybeSingle();
        orderNumber = (data as any)?.number ?? null;
        managerId = (data as any)?.manager_id ?? null;
    }

    await supabase.from('active_calls').upsert([{
        telphin_call_id: callId,
        direction,
        from_number: call.fromNumber ?? null,
        to_number: call.toNumber ?? null,
        extension: call.extension ?? null,
        extension_number: ext,
        is_queue: isQueue,
        manager_id: managerId,
        client_name: who?.name ?? null,
        client_id: who?.clientId ?? null,
        order_id: orderId,
        order_number: orderNumber,
        status: 'ringing',
        started_at: call.startedAt ?? new Date().toISOString(),
        updated_at: new Date().toISOString(),
    }], { onConflict: 'telphin_call_id' });
}

/** Трубку подняли или звонок кончился — окно гаснет. */
export async function callStopped(callId: string, status: 'answered' | 'ended' = 'ended'): Promise<void> {
    const key = String(callId).toUpperCase();

    if (status === 'answered') {
        await supabase
            .from('active_calls')
            .update({ status: 'answered', updated_at: new Date().toISOString() })
            .eq('telphin_call_id', key);
        return;
    }

    await supabase.from('active_calls').delete().eq('telphin_call_id', key);
}

/**
 * Зависшие звонки: Телфин не всегда присылает событие о завершении, и строка
 * может остаться висеть. Старше получаса — это уже не «идёт сейчас».
 */
export async function dropStaleCalls(): Promise<number> {
    const { data } = await supabase
        .from('active_calls')
        .delete()
        .lt('started_at', new Date(Date.now() - 30 * 60 * 1000).toISOString())
        .select('telphin_call_id');

    return ((data ?? []) as any[]).length;
}
