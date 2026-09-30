/**
 * Сводка ошибок владельцу.
 *
 * Ошибки в системе копятся в разных местах и до 30.09.2026 никуда не уходили:
 * журнала `error_logs` вообще не было в базе, а сбои ботов было видно только
 * если залезть в таблицы руками. Так и получилось, что о поломке магазина
 * RetailCRM узнали от менеджеров через четыре часа.
 *
 * Здесь всё собирается в одно место и уходит одним сообщением. Про каждую
 * ошибку сообщаем один раз — повторы помечаем, чтобы не будить человека
 * одинаковыми сообщениями.
 */
import { supabase } from '@/utils/supabase';
import { sendNotification } from '@/lib/notify/send';

export type ErrorItem = {
    /** Где сломалось — человеческим языком. */
    where: string;
    /** Что именно случилось. */
    what: string;
    /** Сколько раз за период. */
    count: number;
};

const MAX_LINES = 12;

function short(text: unknown, limit = 120): string {
    return String(text ?? '').replace(/\s+/g, ' ').trim().slice(0, limit);
}

/** Ошибки из общего журнала, о которых ещё не сообщали. */
async function fromErrorLog(): Promise<{ items: ErrorItem[]; ids: number[] }> {
    const { data } = await supabase
        .from('error_logs')
        .select('id, source, message')
        .is('notified_at', null)
        .eq('level', 'error')
        .order('created_at', { ascending: false })
        .limit(200);

    const grouped = new Map<string, ErrorItem & { ids: number[] }>();
    for (const row of (data || []) as any[]) {
        const key = `${row.source}|${short(row.message, 80)}`;
        const existing = grouped.get(key);
        if (existing) {
            existing.count += 1;
            existing.ids.push(row.id);
        } else {
            grouped.set(key, { where: row.source, what: short(row.message), count: 1, ids: [row.id] });
        }
    }

    const items = Array.from(grouped.values());
    return { items, ids: items.flatMap((item) => item.ids) };
}

/** Заявки с почты, по которым заказ так и не создался. */
async function fromEmails(): Promise<ErrorItem[]> {
    const { data } = await supabase
        .from('incoming_emails')
        .select('error_message')
        .eq('status', 'error')
        .gte('received_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString());

    const rows = (data || []) as any[];
    if (!rows.length) {
        return [];
    }

    return [{
        where: 'Заявки с почты',
        what: `${rows.length} писем не стали заказами. Последняя причина: ${short(rows[0].error_message)}`,
        count: rows.length,
    }];
}

/** Оплаты, которые не удалось провести в RetailCRM. */
async function fromPayments(): Promise<ErrorItem[]> {
    const { data } = await supabase
        .from('point_payments')
        .select('retailcrm_error, push_attempts')
        .not('retailcrm_error', 'is', null)
        .is('retailcrm_synced_at', null)
        .not('matched_order_id', 'is', null);

    const rows = (data || []) as any[];
    if (!rows.length) {
        return [];
    }

    return [{
        where: 'Оплаты',
        what: `${rows.length} платежей не проведены в CRM: ${short(rows[0].retailcrm_error)}`,
        count: rows.length,
    }];
}

/** Задачи бота-РОПа, которым не удалось записать дату контакта. */
async function fromRopTasks(): Promise<ErrorItem[]> {
    const today = new Date().toISOString().slice(0, 10);
    const { data } = await supabase
        .from('sales_rop_task')
        .select('crm_error')
        .not('crm_error', 'is', null)
        .eq('plan_date', today);

    const rows = ((data || []) as any[])
        // «дата контакта назначена на будущее» — это не ошибка, а правило.
        .filter((row) => !String(row.crm_error).includes('на будущее'));

    if (!rows.length) {
        return [];
    }

    return [{
        where: 'План работ',
        what: `${rows.length} заказам не записали дату контакта: ${short(rows[0].crm_error)}`,
        count: rows.length,
    }];
}

/** Задачи конвейера, которые совсем не прошли. */
async function fromDeadJobs(): Promise<ErrorItem[]> {
    const { data } = await supabase
        .from('system_jobs')
        .select('job_type, last_error')
        .eq('status', 'dead_letter')
        .gte('updated_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString());

    const grouped = new Map<string, ErrorItem>();
    for (const row of (data || []) as any[]) {
        const item = grouped.get(row.job_type);
        if (item) {
            item.count += 1;
        } else {
            grouped.set(row.job_type, {
                where: `Задача «${row.job_type}»',`.replace("',", '»').replace('««', '«'),
                what: short(row.last_error),
                count: 1,
            });
        }
    }

    return Array.from(grouped.values());
}

export type DigestResult = { sent: boolean; items: number };

/** Собрать и отправить сводку. Нечего слать — молчим. */
export async function sendErrorDigest(): Promise<DigestResult> {
    const [log, emails, payments, rop, jobs] = await Promise.all([
        fromErrorLog().catch(() => ({ items: [], ids: [] as number[] })),
        fromEmails().catch(() => []),
        fromPayments().catch(() => []),
        fromRopTasks().catch(() => []),
        fromDeadJobs().catch(() => []),
    ]);

    const items = [...log.items, ...emails, ...payments, ...rop, ...jobs];
    if (!items.length) {
        return { sent: false, items: 0 };
    }

    const lines = ['<b>Ошибки в системе</b>', ''];
    for (const item of items.slice(0, MAX_LINES)) {
        lines.push(`• <b>${item.where}</b>${item.count > 1 ? ` (${item.count})` : ''}`);
        lines.push(`  ${item.what}`);
    }
    if (items.length > MAX_LINES) {
        lines.push('', `…и ещё ${items.length - MAX_LINES}`);
    }

    await sendNotification('system.errors_digest', lines.join('\n'));

    // Помечаем разобранные записи журнала, чтобы не слать их дважды.
    if (log.ids.length) {
        await supabase
            .from('error_logs')
            .update({ notified_at: new Date().toISOString() })
            .in('id', log.ids);
    }

    return { sent: true, items: items.length };
}
