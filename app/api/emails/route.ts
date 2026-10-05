import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { supabase } from '@/utils/supabase';

export const dynamic = 'force-dynamic';

/**
 * Общий список писем компании — для раздела «Письма».
 *
 * Почта у компании одна (rop@zmktlt.ru), поэтому список общий: менеджеры должны
 * видеть всю переписку, иначе не отличить дубль от нового клиента (решение
 * владельца 02.10.2026, то же основание, что и у общего списка заказов).
 *
 * Входящие лежат в `incoming_emails` (их разбирает Катерина), исходящие — в
 * `outgoing_emails` (папка «Отправленные» ящика). Склеиваем и отдаём одной лентой.
 */

const TYPE_LABELS: Record<string, string> = {
    new_request: 'Заявка',
    accounting: 'Бухгалтерия',
    logistics: 'Логистика',
    legal: 'Юридическое',
    procurement: 'Закупки',
    reply_thread: 'Ответ в переписке',
    blocked: 'Заблокировано',
    noreply: 'Служебное',
    not_request: 'Не заявка',
    spam: 'Спам',
};

const textFromHtml = (html: unknown): string =>
    String(html ?? '')
        .replace(/<(script|style)[\s\S]*?<\/\1>/gi, '')
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<\/(p|div|tr|li|h[1-6])>/gi, '\n')
        .replace(/<[^>]+>/g, '')
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/\n{3,}/g, '\n\n')
        .trim();

const body = (row: any): string | null => {
    const plain = String(row.body_text ?? '').trim();
    if (plain) return plain;
    const html = textFromHtml(row.body_html);
    return html || null;
};

export async function GET(req: Request) {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: 'Неавторизован' }, { status: 401 });

    const { searchParams } = new URL(req.url);
    const limit = Math.min(500, Math.max(20, parseInt(searchParams.get('limit') || '200', 10)));
    const direction = searchParams.get('direction') || 'all'; // all | in | out
    const type = searchParams.get('type') || '';
    const search = (searchParams.get('search') || '').trim();
    const from = searchParams.get('from');
    const to = searchParams.get('to');

    const wantIncoming = direction !== 'out';
    const wantOutgoing = direction !== 'in';

    let incomingQuery = supabase
        .from('incoming_emails')
        .select('id, subject, from_email, from_name, to_email, body_text, body_html, email_type, status, received_at, has_attachments, created_crm_order_number, assigned_manager_id')
        .order('received_at', { ascending: false })
        .limit(limit);

    let outgoingQuery = supabase
        .from('outgoing_emails')
        .select('id, subject, from_email, to_email, body_text, body_html, sent_at, has_attachments, order_number')
        .order('sent_at', { ascending: false })
        .limit(limit);

    if (from) {
        incomingQuery = incomingQuery.gte('received_at', `${from}T00:00:00+03:00`);
        outgoingQuery = outgoingQuery.gte('sent_at', `${from}T00:00:00+03:00`);
    }
    if (to) {
        incomingQuery = incomingQuery.lte('received_at', `${to}T23:59:59+03:00`);
        outgoingQuery = outgoingQuery.lte('sent_at', `${to}T23:59:59+03:00`);
    }
    if (type) incomingQuery = incomingQuery.eq('email_type', type);
    if (search) {
        incomingQuery = incomingQuery.or(`subject.ilike.%${search}%,from_email.ilike.%${search}%`);
        outgoingQuery = outgoingQuery.or(`subject.ilike.%${search}%,to_email.ilike.%${search}%`);
    }

    const [incoming, outgoing] = await Promise.all([
        wantIncoming ? incomingQuery : Promise.resolve({ data: [] as any[], error: null }),
        // Тип письма есть только у входящих — при фильтре по типу исходящие не показываем.
        wantOutgoing && !type ? outgoingQuery : Promise.resolve({ data: [] as any[], error: null }),
    ]);

    if (incoming.error) console.warn('[emails] входящие не прочитались:', incoming.error.message);
    if (outgoing.error) console.warn('[emails] исходящие не прочитались:', outgoing.error.message);

    const rows = [
        ...((incoming.data ?? []) as any[]).map((row) => ({
            id: `in-${row.id}`,
            direction: 'Входящее',
            date: row.received_at,
            party: row.from_name || row.from_email,
            partyEmail: row.from_email,
            subject: row.subject,
            body: body(row),
            typeLabel: TYPE_LABELS[row.email_type] || row.email_type || null,
            orderNumber: row.created_crm_order_number,
            attachments: !!row.has_attachments,
            assignedManagerId: row.assigned_manager_id ?? null,
        })),
        ...((outgoing.data ?? []) as any[]).map((row) => ({
            id: `out-${row.id}`,
            direction: 'Исходящее',
            date: row.sent_at,
            party: row.to_email,
            partyEmail: row.to_email,
            subject: row.subject,
            body: body(row),
            typeLabel: null,
            orderNumber: row.order_number,
            attachments: !!row.has_attachments,
            assignedManagerId: null,
        })),
    ].sort((a, b) => String(b.date ?? '').localeCompare(String(a.date ?? '')));

    const page = rows.slice(0, limit);

    /**
     * Клиент и его менеджер — по адресу собеседника. Без них список писем не
     * отвечает на главный вопрос «чьё это и кто ведёт» (просьба Лены Парфёновой
     * 05.10.2026: «можно в почте добавить менеджера, название компании и
     * электронную почту клиента»).
     */
    const addresses = Array.from(new Set(page.map((r) => String(r.partyEmail || '').trim().toLowerCase()).filter(Boolean)));
    const clientByEmail = new Map<string, { id: number; name: string; managerId: number | null }>();

    if (addresses.length) {
        const { data: clients } = await supabase
            .from('clients')
            .select('id, company_name, "legalName", email, contact_email, manager_id')
            .or(`email.in.(${addresses.join(',')}),contact_email.in.(${addresses.join(',')})`);

        for (const client of ((clients ?? []) as any[])) {
            const name = client.company_name || client.legalName || null;
            for (const address of [client.email, client.contact_email]) {
                const key = String(address || '').trim().toLowerCase();
                if (key && !clientByEmail.has(key)) {
                    clientByEmail.set(key, { id: Number(client.id), name: name as any, managerId: client.manager_id ?? null });
                }
            }
        }
    }

    // Менеджер клиента, а если у карточки его нет — тот, на кого легло письмо.
    const managerIds = Array.from(new Set([
        ...Array.from(clientByEmail.values()).map((c) => c.managerId),
        ...page.map((row: any) => row.assignedManagerId),
    ].filter(Boolean))) as number[];
    const managerNames = new Map<number, string>();
    if (managerIds.length) {
        const { data: managers } = await supabase
            .from('managers')
            .select('id, first_name, last_name')
            .in('id', managerIds);
        for (const manager of ((managers ?? []) as any[])) {
            managerNames.set(
                Number(manager.id),
                [manager.last_name, manager.first_name].filter(Boolean).join(' ') || `#${manager.id}`,
            );
        }
    }

    const withClients = page.map((row) => {
        const client = clientByEmail.get(String(row.partyEmail || '').trim().toLowerCase()) || null;
        const managerId = client?.managerId || (row as any).assignedManagerId || null;
        return {
            ...row,
            clientId: client?.id ?? null,
            // Названия компании может не быть — тогда показываем, как человек
            // подписался в письме: «Клиент #900000016» не говорит ничего.
            clientName: client?.name || row.party || null,
            managerName: managerId ? managerNames.get(Number(managerId)) ?? null : null,
        };
    });

    return NextResponse.json({
        emails: withClients,
        types: Object.entries(TYPE_LABELS).map(([code, label]) => ({ code, label })),
    });
}
