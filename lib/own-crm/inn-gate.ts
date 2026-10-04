/**
 * ИНН клиента обязателен на сделке: без него нельзя дойти до договора и счёта.
 *
 * Решение владельца 04.10.2026. Корень проблемы: ЦехУспех ищет заказчика только
 * по ИНН (завод работает с юрлицами, дубли по ИНН запрещены), и заказ без ИНН
 * застревал уже на входе в производство — когда менеджер считал работу сделанной.
 *
 * Поэтому проверяем раньше, на переходе в «Договор на согласовании» и «Счёт на
 * оплате»: до этих статусов ИНН должен быть известен. Заодно менеджеру ставится
 * задача уточнить ИНН, чтобы требование не превратилось в тупик.
 */
import { supabase } from '@/utils/supabase';

/** Статусы, до которых ИНН обязателен. Имена берём из справочника, коды — отсюда. */
export const INN_REQUIRED_STATUSES = ['raschet', 'prepayed'] as const;

export const INN_GATE_MESSAGE =
    'У клиента не заполнен ИНН. До договора и счёта он обязателен: по ИНН завод находит заказчика, '
    + 'и без него заказ не уйдёт в производство. Уточните ИНН у клиента и внесите его в карточку.';

/** ИНН считается заполненным, если в нём 10 цифр (организация) или 12 (предприниматель). */
export function hasValidInn(raw: unknown): boolean {
    const digits = String(raw ?? '').replace(/\D/g, '');
    return digits.length === 10 || digits.length === 12;
}

/**
 * ИНН заказа. Хозяин ИНН — карточка клиента, в заказе он лишь отражается
 * (уточнение владельца 04.10.2026). Поэтому сперва спрашиваем карточку: там
 * менеджер его и правит, а в заказе может лежать старое значение или пусто.
 *
 * Заказ остаётся запасным источником: у старых заказов из RetailCRM карточки
 * клиента у нас может не быть вовсе, а реквизиты в заказе сохранились.
 */
export async function orderInn(orderId: number): Promise<string | null> {
    const { data: order } = await supabase
        .from('orders')
        .select('raw_payload')
        .eq('order_id', orderId)
        .maybeSingle();

    const payload: any = (order as any)?.raw_payload || {};

    const clientId = payload.customer?.id;
    if (clientId) {
        const { data: client } = await supabase
            .from('clients')
            .select('inn')
            .eq('id', clientId)
            .maybeSingle();
        const fromClient = (client as any)?.inn || null;
        if (hasValidInn(fromClient)) return String(fromClient);
    }

    const fromOrder = payload.contragent?.INN || payload.contragent?.inn || null;
    return hasValidInn(fromOrder) ? String(fromOrder) : null;
}

/**
 * Ставит менеджеру задачу уточнить ИНН. Повторно не задваивает: одна открытая
 * задача на заказ — иначе список задач завалило бы одинаковыми строками.
 */
export async function ensureInnTask(orderNumber: string, author: string): Promise<boolean> {
    const title = 'Уточнить у клиента ИНН и внести в карточку';

    const { data: exists } = await supabase
        .from('order_tasks')
        .select('id')
        .eq('order_number', orderNumber)
        .eq('title', title)
        .eq('done', false)
        .maybeSingle();
    if (exists) return false;

    const { error } = await supabase.from('order_tasks').insert({
        order_number: orderNumber,
        title,
        created_by: author,
    });
    if (error) {
        console.error('[inn-gate] задача не создалась:', orderNumber, error.message);
        return false;
    }
    return true;
}
