/**
 * Старая переписка — в заказы, массово.
 *
 * Андрей 27.10.2026: «в ОКК в старых заказах не показывается переписка старая,
 * возможно надо первым делом прицепить все письма к заказам ОКК». Кнопка
 * «Загрузить историю» поднимает одну сделку руками, а заказов тысячи.
 *
 * Берём письма ящика с нашим служебным тегом темы `[#N/<номер>]`: тег сам
 * называет заказ, поэтому привязка однозначная и не зависит от адресов
 * клиента. Лента заказа уже умеет искать письма по тегу
 * (`lib/order-mail/load.ts`), так что залитое письмо сразу видно в карточке.
 *
 * Почему только 18 месяцев: столько же владелец отмерил файлам (27.10.2026).
 * Весь архив — 59 831 письмо с тегом, это около 1,6 ГБ тел писем при слабом
 * диске базы (ЗАКОН 16.10.2026). За 18 месяцев — 11 176 входящих и 992
 * отправленных, примерно 330 МБ.
 *
 * Идём пачками от свежих писем к старым, курсор держим в `sync_state`.
 * Повтор не плодит дублей: у таблиц уникальный ключ по ящику, папке и UID.
 *
 * Входящие кладём статусом `archived` со связкой с заказом — к Катерине на
 * разбор они не идут, иначе письмо годовой давности завело бы новую заявку.
 */
import { supabase } from '@/utils/supabase';
import { openImapSession, findSentFolder, isImapConfigured } from '@/lib/email/imap';
import { simpleParser } from 'mailparser';

/** Сколько месяцев назад заходим. */
const MONTHS = 18;

/** Писем за заход: тела тяжёлые, а у крона потолок в 300 секунд. */
const DEFAULT_BATCH = 100;

export type TaggedBackfillResult = {
    ok: boolean;
    error?: string;
    /** Сколько писем разобрали за этот заход. */
    read: number;
    addedIncoming: number;
    addedOutgoing: number;
    /** Сколько писем папки осталось позади курсора. */
    left: number;
};

/** Ключ курсора: своя отметка на каждую папку. */
const cursorKey = (folder: string) => `mail.tagged_backfill.${folder}`;

/** Номер заказа из тега темы: «Re: [#38/54270] …» → «54270». */
export function orderNumberFromSubject(subject: string | null): string | null {
    const match = /\[#\d+\/([^\]\s]+)\]/.exec(String(subject ?? ''));
    return match ? match[1].trim() : null;
}

async function readCursor(folder: string): Promise<number | null> {
    const { data } = await supabase
        .from('sync_state')
        .select('value')
        .eq('key', cursorKey(folder))
        .maybeSingle();
    const value = Number((data as any)?.value);
    return Number.isFinite(value) && value > 0 ? value : null;
}

async function writeCursor(folder: string, uid: number): Promise<void> {
    await supabase.from('sync_state').upsert({
        key: cursorKey(folder),
        value: String(uid),
        updated_at: new Date().toISOString(),
    });
}

/** Заказы по номерам: `order_id` нужен для связки `linked_order_id`. */
async function orderIds(numbers: string[]): Promise<Map<string, number | null>> {
    const out = new Map<string, number | null>();
    const list = Array.from(new Set(numbers.filter(Boolean)));
    if (!list.length) return out;

    for (let from = 0; from < list.length; from += 200) {
        const { data } = await supabase
            .from('orders')
            .select('number, order_id')
            .in('number', list.slice(from, from + 200));
        for (const row of ((data ?? []) as any[])) {
            out.set(String(row.number), row.order_id ?? null);
        }
    }
    return out;
}

/**
 * Один заход по одной папке.
 *
 * `folder` — INBOX или «Отправленные»: в первой лежат письма клиентов, во
 * второй наши. Для карточки заказа нужны обе стороны.
 */
async function pullFolder(params: {
    client: any;
    folder: string;
    kind: 'in' | 'out';
    batch: number;
    mailbox: string;
}): Promise<TaggedBackfillResult> {
    const { client, folder, kind, batch, mailbox } = params;
    const result: TaggedBackfillResult = { ok: true, read: 0, addedIncoming: 0, addedOutgoing: 0, left: 0 };

    const since = new Date();
    since.setMonth(since.getMonth() - MONTHS);

    const lock = await client.getMailboxLock(folder, { readOnly: true } as any);
    let picked: number[] = [];
    let uidValidity = 0;
    try {
        uidValidity = Number((client.mailbox as any)?.uidValidity ?? 0);
        const found: number[] = await client
            .search({ header: { subject: '[#' }, since } as any, { uid: true } as any)
            .catch(() => [] as number[]);

        const cursor = await readCursor(folder);
        // Свежие письма нужнее старых, поэтому идём сверху вниз: курсор — самый
        // старый уже разобранный UID, ниже него и продолжаем.
        const queue = found
            .map(Number)
            .filter((uid) => (cursor === null ? true : uid < cursor))
            .sort((a, b) => b - a);

        picked = queue.slice(0, batch);
        result.left = Math.max(0, queue.length - picked.length);
    } finally {
        lock.release();
    }

    if (!picked.length) return result;

    const letters: Array<{ uid: number; parsed: any; number: string }> = [];
    const lock2 = await client.getMailboxLock(folder, { readOnly: true } as any);
    try {
        for await (const msg of client.fetch(picked, { uid: true, source: true } as any, { uid: true } as any)) {
            const source = (msg as any).source as Buffer | undefined;
            if (!source) continue;
            const parsed = await simpleParser(source);
            result.read += 1;
            const number = orderNumberFromSubject(parsed.subject ?? null);
            // Тег есть не у всех найденных: IMAP ищет подстроку «[#» по всей теме.
            if (number) letters.push({ uid: Number((msg as any).uid), parsed, number });
        }
    } finally {
        lock2.release();
    }

    if (!letters.length) {
        await writeCursor(folder, Math.min(...picked));
        return result;
    }

    const ids = await orderIds(letters.map((l) => l.number));

    if (kind === 'in') {
        const rows = letters
            // Заказа нет у нас — цеплять письмо не к чему.
            .filter((l) => ids.has(l.number))
            .map(({ uid, parsed, number }) => ({
                message_id: parsed.messageId ?? null,
                mailbox,
                folder,
                imap_uid: uid,
                uid_validity: uidValidity,
                from_email: parsed.from?.value?.[0]?.address ?? null,
                from_name: parsed.from?.value?.[0]?.name ?? null,
                to_email: parsed.to?.value?.[0]?.address ?? null,
                subject: parsed.subject ?? null,
                in_reply_to: (parsed.inReplyTo as string) ?? null,
                email_refs: Array.isArray(parsed.references) ? parsed.references.join(' ') : (parsed.references ?? null),
                received_at: parsed.date ? parsed.date.toISOString() : null,
                body_text: parsed.text ?? null,
                body_html: typeof parsed.html === 'string' ? parsed.html : null,
                has_attachments: (parsed.attachments ?? []).length > 0,
                attachments_meta: (parsed.attachments ?? []).map((a: any) => ({
                    filename: a.filename ?? null,
                    contentType: a.contentType ?? null,
                    size: typeof a.size === 'number' ? a.size : null,
                })),
                // Старое письмо не заявка: разбирать его Катерине нечего.
                status: 'archived',
                linked_order_id: ids.get(number) ?? null,
                created_crm_order_number: number,
            }));

        if (rows.length) {
            // Письмо могло прийти и штатным приёмом — тогда запись уже есть.
            const { error, count } = await supabase
                .from('incoming_emails')
                .upsert(rows, { onConflict: 'mailbox,folder,uid_validity,imap_uid', ignoreDuplicates: true, count: 'exact' });
            if (error) {
                console.warn('[tagged-backfill] входящие не записались:', error.message);
                return { ...result, ok: false, error: error.message };
            }
            result.addedIncoming = count ?? rows.length;
        }
    } else {
        const rows = letters.map(({ uid, parsed, number }) => ({
            mailbox,
            folder,
            imap_uid: uid,
            uid_validity: uidValidity,
            message_id: parsed.messageId ?? null,
            subject: parsed.subject ?? null,
            from_email: parsed.from?.value?.[0]?.address ?? null,
            to_email: parsed.to?.value?.[0]?.address ?? null,
            sent_at: parsed.date ? parsed.date.toISOString() : null,
            body_text: parsed.text ?? null,
            body_html: typeof parsed.html === 'string' ? parsed.html : null,
            has_attachments: (parsed.attachments ?? []).length > 0,
            attachments_meta: (parsed.attachments ?? []).map((a: any) => ({
                filename: a.filename ?? null,
                contentType: a.contentType ?? null,
                size: typeof a.size === 'number' ? a.size : null,
            })),
            order_number: number,
        }));

        const { error, count } = await supabase
            .from('outgoing_emails')
            .upsert(rows, { onConflict: 'mailbox,folder,uid_validity,imap_uid', count: 'exact' });
        if (error) {
            console.warn('[tagged-backfill] исходящие не записались:', error.message);
            return { ...result, ok: false, error: error.message };
        }
        result.addedOutgoing = count ?? rows.length;
    }

    // Курсор двигаем только после записи: упали на полпути — пачку переберём.
    await writeCursor(folder, Math.min(...picked));
    return result;
}

/** Заход по обеим папкам. Одно соединение с ящиком на весь проход. */
export async function backfillTaggedMail(batch = DEFAULT_BATCH): Promise<TaggedBackfillResult> {
    const empty: TaggedBackfillResult = { ok: false, read: 0, addedIncoming: 0, addedOutgoing: 0, left: 0 };

    if (!isImapConfigured()) return { ...empty, error: 'Доступ к почтовому ящику не настроен' };

    const mailbox = process.env.IMAP_USER || process.env.SMTP_USER || '';
    const sentFolder = await findSentFolder();
    const session = await openImapSession();
    if (!session) return { ...empty, error: 'Почтовый ящик не отвечает' };

    const total: TaggedBackfillResult = { ok: true, read: 0, addedIncoming: 0, addedOutgoing: 0, left: 0 };

    try {
        const folders: Array<{ folder: string; kind: 'in' | 'out' }> = [{ folder: 'INBOX', kind: 'in' }];
        if (sentFolder) folders.push({ folder: sentFolder, kind: 'out' });

        for (const { folder, kind } of folders) {
            const part = await pullFolder({ client: session.client, folder, kind, batch, mailbox });
            total.read += part.read;
            total.addedIncoming += part.addedIncoming;
            total.addedOutgoing += part.addedOutgoing;
            total.left += part.left;
            if (!part.ok) return { ...total, ok: false, error: part.error };
        }

        return total;
    } catch (e: any) {
        console.error('[tagged-backfill] проход не удался:', e?.message || e);
        return { ...total, ok: false, error: String(e?.message ?? e) };
    } finally {
        await session.close();
    }
}
