/**
 * Журнал оплат по своим заказам.
 *
 * По заказам RetailCRM оплаты живут там: бот разносит поступления из банка
 * методом `orders/payments/create`. У своего заказа этого пути нет — заказа в
 * RetailCRM не существует, отражать платёж негде. Поэтому свой журнал.
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
            .from('own_order_payments')
            .select('id')
            .eq('point_payment_id', payment.pointPaymentId)
            .maybeSingle();
        if (data) return Number((data as any).id);
    }

    const { data, error } = await supabase
        .from('own_order_payments')
        .insert({
            order_id: payment.orderId,
            order_number: payment.orderNumber,
            amount: Number(payment.amount),
            paid_at: payment.paidAt,
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
        .from('own_order_payments')
        .select('id, amount, paid_at, method, payer_name, purpose, note, created_by')
        .eq('order_id', orderId)
        .order('paid_at', { ascending: true });

    return ((data ?? []) as any[]).map((r) => ({
        id: Number(r.id),
        amount: Number(r.amount),
        paidAt: String(r.paid_at),
        method: r.method ?? null,
        payerName: r.payer_name ?? null,
        purpose: r.purpose ?? null,
        note: r.note ?? null,
        createdBy: r.created_by ?? null,
    }));
}

export async function removeOwnPayment(paymentId: number): Promise<void> {
    const { error } = await supabase.from('own_order_payments').delete().eq('id', paymentId);
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
