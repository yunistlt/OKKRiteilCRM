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
import { fixCharsetMojibake } from '@/lib/email/mojibake';

/** Сколько месяцев назад заходим. */
const MONTHS = 18;

/** Писем за заход: тела тяжёлые, а у крона потолок в 300 секунд. */
const DEFAULT_BATCH = 100;

/**
 * Сколько UID просматриваем на одно нужное письмо. В ящике с тегом заказа
 * примерно каждое третье письмо, запас берём двойной: лишние конверты стоят
 * дёшево, а недобор означал бы полупустые проходы.
 */
const SCAN_PER_LETTER = 6;

/**
 * Сколько времени проход работает в одном заходе. У маршрута потолок 300
 * секунд (`maxDuration`), оставляем запас на запись и закрытие сессии.
 */
const DEFAULT_BUDGET_MS = 230_000;

export type TaggedBackfillResult = {
    ok: boolean;
    error?: string;
    /** Сколько писем разобрали за этот заход. */
    read: number;
    addedIncoming: number;
    addedOutgoing: number;
    /** Сколько UID осталось просмотреть ниже курсора (письма, не все с тегом). */
    left: number;
    /** Сколько писем отбросили как роботные. */
    robots: number;
    /** Сколько пачек успели прокрутить за заход. */
    passes: number;
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
    const result: TaggedBackfillResult = { ok: true, read: 0, addedIncoming: 0, addedOutgoing: 0, left: 0, robots: 0, passes: 0 };

    const since = new Date();
    since.setMonth(since.getMonth() - MONTHS);

    /**
     * Идём по диапазонам UID, а не поиском по всему ящику.
     *
     * IMAP SEARCH по 167 тысячам писем Яндекс терпит пару раз, а потом
     * отвечает `false` и роняет соединение — ровно это и случилось на пробе
     * 27.10.2026. Поэтому берём подряд идущий кусок UID ниже курсора, читаем
     * у него только конверты (тема и дата — дёшево) и за телами идём лишь к
     * тем письмам, у которых в теме наш тег.
     */
    const lock = await client.getMailboxLock(folder, { readOnly: true } as any);
    let picked: number[] = [];
    let uidValidity = 0;
    let bottom = 1;
    let tooOld = false;
    try {
        uidValidity = Number((client.mailbox as any)?.uidValidity ?? 0);
        const uidNext = Number((client.mailbox as any)?.uidNext ?? 0);

        const cursor = (await readCursor(folder)) ?? (uidNext > 0 ? uidNext : 1);
        const top = cursor - 1;
        if (top < 1) return { ...result, left: 0 };

        bottom = Math.max(1, top - batch * SCAN_PER_LETTER + 1);
        result.left = bottom - 1;

        for await (const msg of client.fetch(
            `${bottom}:${top}`,
            { uid: true, envelope: true } as any,
            { uid: true } as any,
        )) {
            const envelope = (msg as any).envelope ?? {};
            const date: Date | null = envelope.date ? new Date(envelope.date) : null;
            if (date && date < since) { tooOld = true; continue; }
            if (!orderNumberFromSubject(envelope.subject ?? null)) continue;
            picked.push(Number((msg as any).uid));
        }

        // Самые свежие вперёд, и не больше пачки за заход.
        picked = picked.sort((a, b) => b - a).slice(0, batch);
    } finally {
        lock.release();
    }

    /**
     * Весь просмотренный кусок старше 18 месяцев — дальше вниз только архив,
     * который мы не берём. Курсор ставим в единицу: проходы станут холостыми.
     */
    if (!picked.length) {
        await writeCursor(folder, tooOld ? 1 : bottom);
        return { ...result, left: tooOld ? 0 : result.left };
    }

    const letters: Array<{ uid: number; parsed: any; number: string }> = [];
    const lock2 = await client.getMailboxLock(folder, { readOnly: true } as any);
    try {
        for await (const msg of client.fetch(picked, { uid: true, source: true } as any, { uid: true } as any)) {
            const source = (msg as any).source as Buffer | undefined;
            if (!source) continue;
            const parsed = await simpleParser(source);
            result.read += 1;
            const number = orderNumberFromSubject(parsed.subject ?? null);
            if (number) letters.push({ uid: Number((msg as any).uid), parsed, number });
        }
    } finally {
        lock2.release();
    }

    if (!letters.length) {
        await writeCursor(folder, bottom);
        return result;
    }

    const ids = await orderIds(letters.map((l) => l.number));

    if (kind === 'in') {
        /**
         * Роботные уведомления не переносим (решение владельца 27.10.2026):
         * переписки в них нет, а места и времени они занимают наравне с
         * настоящими письмами.
         *
         * Признак — отправитель совпадает с нашим же ящиком: так приходят
         * «Долгое нахождение в статусе» от RetailCRM (250 писем из 901) и
         * письма Елены про горячих лидов. Ответ клиента на такое уведомление
         * приходит уже с его адреса и переносится как обычно.
         */
        const worth = letters.filter(({ parsed }) => {
            const from = String(parsed.from?.value?.[0]?.address ?? '').trim().toLowerCase();
            const robot = Boolean(from) && from === mailbox.trim().toLowerCase();
            if (robot) result.robots += 1;
            return !robot;
        });

        const rows = worth
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
                // Письмо могло соврать о кодировке — см. lib/email/mojibake.ts.
                body_text: fixCharsetMojibake(parsed.text ?? null),
                body_html: fixCharsetMojibake(typeof parsed.html === 'string' ? parsed.html : null),
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
            /**
             * Письмо могло прийти и штатным приёмом — тогда запись уже есть.
             * Через `upsert` сюда не зайти: уникальные индексы у таблицы
             * частичные (`WHERE imap_uid IS NOT NULL`), а `ON CONFLICT` таким
             * не пользуется. Поэтому сначала смотрим, что уже лежит.
             */
            const { data: known } = await supabase
                .from('incoming_emails')
                .select('imap_uid')
                .eq('mailbox', mailbox)
                .eq('folder', folder)
                .in('imap_uid', rows.map((row) => row.imap_uid));
            const seen = new Set(((known ?? []) as any[]).map((row) => Number(row.imap_uid)));

            const fresh = rows.filter((row) => !seen.has(row.imap_uid));

            for (const row of fresh) {
                const { error } = await supabase.from('incoming_emails').insert(row);
                // Тот же Message-ID мог прийти другой папкой — это не ошибка.
                if (error && !String(error.message).includes('duplicate key')) {
                    console.warn('[tagged-backfill] входящее не записалось:', row.imap_uid, error.message);
                    return { ...result, ok: false, error: error.message };
                }
                if (!error) result.addedIncoming += 1;
            }
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
            body_text: fixCharsetMojibake(parsed.text ?? null),
            body_html: fixCharsetMojibake(typeof parsed.html === 'string' ? parsed.html : null),
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

    // Курсор двигаем только после записи: упали на полпути — кусок переберём.
    await writeCursor(folder, bottom);
    return result;
}

/** Заход по обеим папкам. Одно соединение с ящиком на весь проход. */
export async function backfillTaggedMail(
    batch = DEFAULT_BATCH,
    budgetMs = DEFAULT_BUDGET_MS,
): Promise<TaggedBackfillResult> {
    const empty: TaggedBackfillResult = { ok: false, read: 0, addedIncoming: 0, addedOutgoing: 0, left: 0, robots: 0, passes: 0 };

    if (!isImapConfigured()) return { ...empty, error: 'Доступ к почтовому ящику не настроен' };

    const mailbox = process.env.IMAP_USER || process.env.SMTP_USER || '';
    const sentFolder = await findSentFolder();
    const session = await openImapSession();
    if (!session) return { ...empty, error: 'Почтовый ящик не отвечает' };

    const total: TaggedBackfillResult = { ok: true, read: 0, addedIncoming: 0, addedOutgoing: 0, left: 0, robots: 0, passes: 0 };

    /**
     * Один вход в ящик — много работы.
     *
     * Ящик Яндекса считает именно сессии и при частых входах отвечает
     * «Connection not available» (27.10.2026), поэтому ускоряемся не частотой
     * захода, а работой внутри него: крутим пачки, пока есть бюджет времени.
     * Потолок маршрута — 300 секунд, оставляем запас на закрытие сессии.
     */
    const deadline = Date.now() + budgetMs;

    try {
        const folders: Array<{ folder: string; kind: 'in' | 'out' }> = [{ folder: 'INBOX', kind: 'in' }];
        if (sentFolder) folders.push({ folder: sentFolder, kind: 'out' });

        for (const { folder, kind } of folders) {
            // Папка кончилась — курсор дошёл до дна, крутить её незачем.
            while (Date.now() < deadline) {
                const part = await pullFolder({ client: session.client, folder, kind, batch, mailbox });
                total.read += part.read;
                total.addedIncoming += part.addedIncoming;
                total.addedOutgoing += part.addedOutgoing;
                total.left = part.left;
                total.robots += part.robots;
                total.passes += 1;
                if (!part.ok) return { ...total, ok: false, error: part.error };
                if (part.left === 0) break;
            }
        }

        return total;
    } catch (e: any) {
        console.error('[tagged-backfill] проход не удался:', e?.message || e);
        return { ...total, ok: false, error: String(e?.message ?? e) };
    } finally {
        await session.close();
    }
}
