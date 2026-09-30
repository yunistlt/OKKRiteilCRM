/**
 * Что происходило с клиентом: звонки и письма.
 *
 * Как связываем — по факту данных (проверено 30.09.2026):
 * - Телефоны в карточках клиентов не заполнены ни у одного из 20 699, поэтому
 *   телефон берём из его заказов.
 * - Номер клиента в звонках (`customer_rc_id`) не совпадает с номерами наших
 *   карточек ни разу — связать напрямую нельзя. Зато у 81% звонков проставлен
 *   номер заказа, и через заказы клиента звонки находятся у 2 152 клиентов.
 * - Письма ищем по адресу отправителя.
 */
import { supabase } from '@/utils/supabase';

export type ClientCall = {
    at: string;
    /** «входящий» или «исходящий» — человеку, а не кодом. */
    direction: string;
    durationSec: number | null;
    managerName: string | null;
    orderNumber: string | null;
    missed: boolean;
    hasRecording: boolean;
};

export type ClientEmail = {
    at: string;
    from: string | null;
    subject: string | null;
    /** Что секретарь сделала с письмом, по-русски. */
    outcome: string;
    orderNumber: string | null;
};

const EMAIL_OUTCOMES: Record<string, string> = {
    new_request: 'Заведена заявка',
    reply_thread: 'Переписка по заказу',
    accounting: 'Передано в бухгалтерию',
    logistics: 'Передано логистам',
    legal: 'Передано юристам',
    procurement: 'Передано снабжению',
    not_request: 'Не заявка',
    blocked: 'Отправитель в исключениях',
    noreply: 'Письмо-робот',
};

/** Номера заказов клиента — общий ключ для звонков. */
async function orderNumbers(customerId: string): Promise<string[]> {
    const { data } = await supabase
        .from('orders')
        .select('number')
        .filter('customer->>id', 'eq', customerId)
        .not('number', 'is', null);

    return (data || []).map((row: any) => String(row.number));
}

/** Звонки клиента — через номера его заказов. */
export async function clientCalls(customerId: string, limit = 30): Promise<ClientCall[]> {
    const numbers = await orderNumbers(customerId);
    if (!numbers.length) {
        return [];
    }

    const { data, error } = await supabase
        .from('retailcrm_calls')
        .select('call_date, call_type, duration_sec, manager_name, order_number, is_missed, record_uuid')
        .in('order_number', numbers)
        .order('call_date', { ascending: false })
        .limit(limit);

    if (error) {
        throw error;
    }

    return (data || []).map((row: any) => ({
        at: row.call_date,
        direction: row.call_type === 'in' ? 'входящий' : row.call_type === 'out' ? 'исходящий' : 'звонок',
        durationSec: row.duration_sec ?? null,
        managerName: row.manager_name || null,
        orderNumber: row.order_number || null,
        missed: Boolean(row.is_missed),
        hasRecording: Boolean(row.record_uuid),
    }));
}

/** Письма от клиента и что с ними сделал секретарь. */
export async function clientEmails(addresses: string[], limit = 20): Promise<ClientEmail[]> {
    const clean = addresses.filter(Boolean).map((a) => String(a).trim().toLowerCase());
    if (!clean.length) {
        return [];
    }

    const { data, error } = await supabase
        .from('incoming_emails')
        .select('received_at, from_email, subject, email_type, status, created_crm_order_number')
        .in('from_email', clean)
        .order('received_at', { ascending: false })
        .limit(limit);

    if (error) {
        throw error;
    }

    return (data || []).map((row: any) => ({
        at: row.received_at,
        from: row.from_email || null,
        subject: row.subject || null,
        outcome: row.status === 'error'
            ? 'Ошибка разбора — смотрит человек'
            : (EMAIL_OUTCOMES[row.email_type] || 'В разборе'),
        orderNumber: row.created_crm_order_number || null,
    }));
}

/** Телефон клиента — из его последнего заказа: в карточках он не заполняется. */
export async function clientPhone(customerId: string): Promise<string | null> {
    const { data } = await supabase
        .from('orders')
        .select('phone, "additionalPhone", "createdAt"')
        .filter('customer->>id', 'eq', customerId)
        .not('phone', 'is', null)
        .order('createdAt', { ascending: false })
        .limit(1);

    const row = (data || [])[0] as any;
    return row?.phone || row?.additionalPhone || null;
}
