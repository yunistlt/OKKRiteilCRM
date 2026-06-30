/**
 * Реестр исходящих писем по заказу (таблица order_email_sends) — для идемпотентности
 * отправки: не дать задвоить одно и то же письмо даже после перезагрузки страницы.
 */
import { supabase } from '@/utils/supabase';

export interface OrderEmailSend {
    created_at: string;
    to_email: string;
    subject: string;
    message_id: string | null;
    sent_by: string | null;
}

/** Последняя отправка письма по заказу (по номеру), либо null. */
export async function getLastOrderEmailSend(orderNumber: string): Promise<OrderEmailSend | null> {
    const { data } = await supabase
        .from('order_email_sends')
        .select('created_at, to_email, subject, message_id, sent_by')
        .eq('order_number', orderNumber)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
    return (data as OrderEmailSend) || null;
}

/** Фиксирует факт успешной отправки письма по заказу. Не бросает — журнал не критичен для отправки. */
export async function recordOrderEmailSend(rec: {
    orderNumber: string;
    orderId?: number | null;
    toEmail: string;
    subject: string;
    messageId?: string | null;
    appendedToSent: boolean;
    sentBy?: string | null;
}): Promise<void> {
    try {
        await supabase.from('order_email_sends').insert({
            order_number: rec.orderNumber,
            order_id: rec.orderId ?? null,
            to_email: rec.toEmail,
            subject: rec.subject,
            message_id: rec.messageId ?? null,
            appended_to_sent: rec.appendedToSent,
            sent_by: rec.sentBy ?? null,
        });
    } catch (e: any) {
        console.warn('[order-email-log] запись не удалась:', e?.message || e);
    }
}
