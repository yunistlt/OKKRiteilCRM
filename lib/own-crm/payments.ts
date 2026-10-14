/**
 * Оплаты по своим заказам.
 *
 * По заказам RetailCRM оплаты разносит бот методом `orders/payments/create`, и
 * оттуда они приезжают к нам в `order_payments`. У своего заказа этого пути нет
 * — заказа в RetailCRM не существует, отражать платёж негде, поэтому вносим
 * оплату сами.
 *
 * Пишем в ТУ ЖЕ `order_payments`, помечая строку `source = 'okk'` (решение
 * владельца 14.10.2026, закон об одном источнике правды). Отдельная таблица
 * `own_order_payments` стоила показателя предоплаты: расчёт зарплаты читал
 * только `order_payments`, и у Евгении Матвеевой за октябрь вышло 4 % вместо
 * 83 %, у Елены Парфёновой — 0,5 % вместо 100 %.
 *
 * Что он должен уметь по работе менеджера: видеть, сколько по заказу пришло и
 * сколько осталось, и откуда взялась каждая цифра (закон «числа
 * расшифровываемы»).
 */
import { supabase } from '@/utils/supabase';
import { loadOrderItems } from './orders';

export type OwnPayment = {
    id: number;
    amount: number;
    paidAt: string;
    method: string | null;
    payerName: string | null;
    purpose: string | null;
    note: string | null;
    createdBy: string | null;
};

export type NewOwnPayment = {
    orderId: number;
    orderNumber: string;
    amount: number;
    paidAt: string;
    method?: string | null;
    payerName?: string | null;
    purpose?: string | null;
    pointPaymentId?: number | null;
    createdBy?: string | null;
    note?: string | null;
};

/** Что не так с платежом — словами, до записи. */
export function validatePayment(payment: NewOwnPayment): string[] {
    const problems: string[] = [];
    if (!(Number(payment.amount) > 0)) problems.push('Сумма платежа должна быть больше нуля');
    if (!payment.paidAt) problems.push('Не указана дата платежа');
    if (!payment.orderId) problems.push('Платёж не привязан к заказу');
    return problems;
}

export async function addOwnPayment(payment: NewOwnPayment): Promise<number> {
    const problems = validatePayment(payment);
    if (problems.length) throw new Error(problems.join('; '));

    // Тот же платёж из банка дважды не проводим: поступление приходит с
    // идентификатором, по нему и узнаём повтор.
    if (payment.pointPaymentId) {
        const { data } = await supabase
            .from('order_payments')
            .select('id')
            .eq('point_payment_id', payment.pointPaymentId)
            .maybeSingle();
        if (data) return Number((data as any).id);
    }

    // `id` в таблице — идентификатор платежа RetailCRM, своей нумерации там нет.
    // Свои берём из диапазона 900 000 000+, как и номера своих заказов.
    const { data: idRow, error: idErr } = await supabase.rpc('next_own_payment_id');
    if (idErr) throw new Error(`Не удалось получить номер платежа: ${idErr.message}`);

    const { data, error } = await supabase
        .from('order_payments')
        .insert({
            id: Number(idRow),
            order_id: payment.orderId,
            source: 'okk',
            // Оплату вносят, УВИДЕВ деньги, — это приход, а не выставленный счёт.
            status: 'paid',
            amount: Number(payment.amount),
            paidAt: payment.paidAt,
            method: payment.method ?? null,
            payer_name: payment.payerName ?? null,
            purpose: payment.purpose ?? null,
            point_payment_id: payment.pointPaymentId ?? null,
            created_by: payment.createdBy ?? null,
            note: payment.note ?? null,
        })
        .select('id')
        .single();

    if (error) throw new Error(`Не удалось записать оплату: ${error.message}`);
    return Number((data as any).id);
}

export async function ownOrderPayments(orderId: number): Promise<OwnPayment[]> {
    const { data } = await supabase
        .from('order_payments')
        .select('id, amount, paidAt, method, payer_name, purpose, note, created_by')
        .eq('order_id', orderId)
        .eq('source', 'okk')
        .order('paidAt', { ascending: true });

    return ((data ?? []) as any[]).map((r) => ({
        id: Number(r.id),
        amount: Number(r.amount),
        paidAt: String(r.paidAt).slice(0, 10),
        method: r.method ?? null,
        payerName: r.payer_name ?? null,
        purpose: r.purpose ?? null,
        note: r.note ?? null,
        createdBy: r.created_by ?? null,
    }));
}

export async function removeOwnPayment(paymentId: number): Promise<void> {
    // Удалять можно только внесённое у нас: строка из снимка RetailCRM вернётся
    // при первой же пересборке, а до неё разъедутся цифры.
    const { error } = await supabase
        .from('order_payments')
        .delete()
        .eq('id', paymentId)
        .eq('source', 'okk');
    if (error) throw new Error(error.message);
}

/** Сколько пришло и сколько осталось — с раскладкой по платежам. */
export async function paymentState(orderId: number): Promise<{
    total: number;
    paid: number;
    left: number;
    payments: OwnPayment[];
}> {
    const [itemsByOrder, payments] = await Promise.all([loadOrderItems([orderId]), ownOrderPayments(orderId)]);
    const items = itemsByOrder.get(orderId) ?? [];
    // Сумма заказа — сумма позиций за вычетом скидок: так же, как её видит
    // карточка, чтобы «осталось» не расходилось с тем, что на экране.
    const total = items.reduce(
        (sum, item) => sum + (Number(item.initialPrice ?? 0) * Number(item.quantity ?? 0) - Number(item.discountTotal ?? 0) * Number(item.quantity ?? 0)),
        0,
    );
    const paid = payments.reduce((sum, p) => sum + p.amount, 0);
    return { total, paid, left: Math.max(0, total - paid), payments };
}
