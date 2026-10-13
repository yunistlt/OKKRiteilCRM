import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { orderFromSubject } from '@/lib/email/order-tag';
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

/** Служебное и мусор: в «Разборе» их быть не должно, иначе лента мертва (ТЗ §8). */
const SERVICE_TYPES = new Set(['spam', 'noreply', 'blocked', 'not_request']);

/**
 * Чего в «Разборе» быть не должно сверх мусора.
 *
 * «Закупки» — предложения поставщиков: реклама тренажёров, шнуров и складских
 * услуг. К заказам они не относятся никогда, а в разборе их больше, чем
 * работы (увидел при проверке 11.10.2026). Нужны — есть фильтр по типу.
 */
const NOT_FOR_TRIAGE = new Set(['spam', 'noreply', 'blocked', 'not_request', 'procurement']);

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

/**
 * Текст письма для СПИСКА — коротким куском.
 *
 * Полное тело здесь не нужно: в ленте показывается первая строка. А весит оно
 * много: двести писем с вёрсткой — 6,2 МБ, без неё — 666 КБ, а с обрезкой —
 * около шестидесяти (замер 05.10.2026, жалоба владельца «долго письма
 * загружаются»). Полный текст догружается при раскрытии письма.
 */
const PREVIEW_LIMIT = 400;

const body = (row: any): string | null => {
    const plain = String(row.body_text ?? '').trim();
    if (!plain) return null;
    return plain.length > PREVIEW_LIMIT ? `${plain.slice(0, PREVIEW_LIMIT)}…` : plain;
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
    /**
     * Чьи письма показываем (ТЗ §9, этап 4):
     *  - `all` — вся почта компании, как было;
     *  - `mine` — личная лента: письма по МОИМ заказам;
     *  - `unlinked` — «Разбор»: входящие, которые ни к какому заказу не
     *    привязались. Непривязанное письмо — видимая работа, а не тихая папка.
     */
    const scope = searchParams.get('scope') || 'all';

    const wantIncoming = direction !== 'out';
    const wantOutgoing = direction !== 'in';

    let incomingQuery = supabase
        .from('incoming_emails')
        .select('id, subject, from_email, from_name, to_email, body_text, email_type, status, received_at, has_attachments, attachments_meta, created_crm_order_number, assigned_manager_id')
        .order('received_at', { ascending: false })
        .limit(limit);

    let outgoingQuery = supabase
        .from('outgoing_emails')
        .select('id, subject, from_email, to_email, body_text, sent_at, has_attachments, attachments_meta, order_number')
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

    /**
     * «Разбор» и «Мои» отбираем ЗАПРОСОМ, а не фильтром по последним двум
     * сотням писем.
     *
     * Иначе экран врал: сверху написано «ждут разбора 151», а в списке пять
     * штук — те, что попали в окно последних писем (поймано на проверке
     * 11.10.2026).
     */
    if (scope === 'unlinked') {
        incomingQuery = incomingQuery
            .is('created_crm_order_number', null)
            .not('email_type', 'in', `(${Array.from(NOT_FOR_TRIAGE).join(',')})`);
    }

    if (scope === 'mine') {
        const managerId = Number(session.user.retail_crm_manager_id) || null;
        if (!managerId) {
            return NextResponse.json({ emails: [], stats: null, types: Object.entries(TYPE_LABELS).map(([code, label]) => ({ code, label })) });
        }

        const { data: myOrders } = await supabase
            .from('orders')
            .select('number')
            .eq('manager_id', managerId)
            .order('createdAt', { ascending: false })
            .limit(1000);

        const numbers = ((myOrders ?? []) as any[]).map((row) => String(row.number)).filter(Boolean);
        if (!numbers.length) {
            return NextResponse.json({ emails: [], stats: null, types: Object.entries(TYPE_LABELS).map(([code, label]) => ({ code, label })) });
        }

        incomingQuery = incomingQuery.in('created_crm_order_number', numbers);
        outgoingQuery = outgoingQuery.in('order_number', numbers);
    }
    if (search) {
        incomingQuery = incomingQuery.or(`subject.ilike.%${search}%,from_email.ilike.%${search}%`);
        outgoingQuery = outgoingQuery.or(`subject.ilike.%${search}%,to_email.ilike.%${search}%`);
    }

    const [incoming, outgoing] = await Promise.all([
        wantIncoming ? incomingQuery : Promise.resolve({ data: [] as any[], error: null }),
        /**
         * Тип письма есть только у входящих — при фильтре по типу исходящие не
         * показываем. В «Разборе» их нет по смыслу: там входящие без заказа, и
         * если брать исходящие, они съедают страницу и список выглядит почти
         * пустым (поймано 11.10.2026).
         */
        wantOutgoing && !type && scope !== 'unlinked'
            ? outgoingQuery
            : Promise.resolve({ data: [] as any[], error: null }),
    ]);

    if (incoming.error) console.warn('[emails] входящие не прочитались:', incoming.error.message);
    if (outgoing.error) console.warn('[emails] исходящие не прочитались:', outgoing.error.message);

    /**
     * Имена вложений. Ирина Гордеева 05.10.2026: «можно в письмах, чтобы было
     * ТЗ» — раньше отдавали только признак «есть вложения», и файл приходилось
     * искать в заказе.
     */
    const files = (meta: unknown): Array<{ name: string; size: number | null }> =>
        (Array.isArray(meta) ? meta : [])
            .map((item: any) => ({
                name: String(item?.filename ?? '').trim(),
                size: Number.isFinite(Number(item?.size)) ? Number(item.size) : null,
            }))
            .filter((item) => item.name);

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
            rawType: row.email_type ?? null,
            /**
             * Номер заказа: из автоприёма, а если его нет — из тега в теме.
             * Ответы клиентов приходят с нашим тегом «[#3/54929]» и заказа не
             * создают, поэтому письмо выглядело непривязанным и вложение из
             * него не открывалось (жалоба владельца 05.10.2026).
             */
            orderNumber: row.created_crm_order_number || orderFromSubject(row.subject).tagged,
            attachments: !!row.has_attachments,
            attachmentList: files(row.attachments_meta),
            emailId: String(row.id),
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
            rawType: null,
            orderNumber: row.order_number || orderFromSubject(row.subject).tagged,
            attachments: !!row.has_attachments,
            attachmentList: files(row.attachments_meta),
            /**
             * У исходящих ссылки на файл нет: вложение достаётся из почтового
             * ящика по идентификатору ВХОДЯЩЕГО письма, а журнал отправок его не
             * хранит. Имена показываем, открыть можно из карточки заказа.
             */
            emailId: null,
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

    /**
     * Менеджер ЗАКАЗА, указанного в письме, — главный ответ на вопрос «кто
     * писал». Жалоба Евгении Матвеевой 07.10.2026: «у одной и той же
     * организации несколько заказов (дубли), нужно видеть, кто написал письмо,
     * а то приходится открывать и просматривать».
     *
     * У исходящих автора в ящике нет вовсе: они читаются из папки
     * «Отправленные» общего ящика rop@zmktlt.ru, отправитель там один на всех.
     * Поэтому письмо связывает с человеком заказ, а не адрес.
     */
    const orderNumbers = Array.from(new Set(page.map((r) => String(r.orderNumber || '').trim()).filter(Boolean)));
    const managerByOrder = new Map<string, number>();
    if (orderNumbers.length) {
        const { data: orders } = await supabase
            .from('orders')
            .select('number, manager_id')
            .in('number', orderNumbers);
        for (const order of ((orders ?? []) as any[])) {
            if (order.manager_id) managerByOrder.set(String(order.number), Number(order.manager_id));
        }
    }

    // Порядок: менеджер заказа → менеджер карточки клиента → тот, на кого
    // автоприём положил входящее письмо.
    const managerOf = (row: any): number | null =>
        managerByOrder.get(String(row.orderNumber || '')) ??
        clientByEmail.get(String(row.partyEmail || '').trim().toLowerCase())?.managerId ??
        row.assignedManagerId ??
        null;

    const managerIds = Array.from(new Set(page.map(managerOf).filter(Boolean))) as number[];
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

    /**
     * Доля автопривязки — мера того, работает ли разбор (ТЗ §10). Считаем по
     * входящим за две недели: сколько из тех, что вообще относятся к работе
     * (не спам и не служебные), доехали до заказа сами.
     */
    let stats: { period: string; total: number; linked: number; share: number; unlinked: number } | null = null;
    if (scope === 'unlinked') {
        const since = new Date(Date.now() - 14 * 86400000).toISOString();
        const { data: recent } = await supabase
            .from('incoming_emails')
            .select('created_crm_order_number, email_type, subject')
            .gt('received_at', since)
            .limit(3000);

        const work = ((recent ?? []) as any[]).filter((row) => !NOT_FOR_TRIAGE.has(String(row.email_type ?? '')));
        /**
         * Привязанным считаем и письмо с нашим тегом в теме: заказ у него есть,
         * просто записан не колонкой. Иначе наверху стояло «ждут разбора 151»,
         * а в списке было восемнадцать (поймано 11.10.2026).
         */
        const linked = work.filter((row) =>
            row.created_crm_order_number || orderFromSubject(row.subject).tagged).length;
        stats = {
            period: 'за две недели',
            total: work.length,
            linked,
            share: work.length ? Math.round((linked / work.length) * 100) : 0,
            unlinked: work.length - linked,
        };
    }

    const withClients = page.map((row) => {
        const client = clientByEmail.get(String(row.partyEmail || '').trim().toLowerCase()) || null;
        const managerId = managerOf(row);
        return {
            ...row,
            clientId: client?.id ?? null,
            // Названия компании может не быть — тогда показываем, как человек
            // подписался в письме: «Клиент #900000016» не говорит ничего.
            clientName: client?.name || row.party || null,
            managerName: managerId ? managerNames.get(Number(managerId)) ?? null : null,
        };
    });

    const visible = withClients.filter((row) => {
        // Письмо с нашим тегом в теме заказ уже нашло — в разборе ему не место.
        if (scope === 'unlinked') return row.direction === 'Входящее' && !row.orderNumber;
        return true;
    });

    return NextResponse.json({
        emails: visible,
        stats,
        types: Object.entries(TYPE_LABELS).map(([code, label]) => ({ code, label })),
    });
}
