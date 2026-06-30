/**
 * Read-only IMAP-ридер общего почтового ящика (rop@zmktlt.ru) на Яндекс 360.
 *
 * Принципы (см. память проекта «email-intake»):
 *  - Читаем тот же ящик, что и RetailCRM, в РЕЖИМЕ READ-ONLY (mailboxOpen ... readOnly:true,
 *    fetch ... { uid:true } через BODY.PEEK). Флаг \Seen НЕ трогаем — он общий с RetailCRM.
 *  - Не опираемся на \Seen как на «обработано». Ведём собственный указатель last_seen_uid
 *    в таблице email_ingest_state и тянем только новые письма (UID > last_seen_uid).
 *  - Дедуп — на уровне БД (incoming_emails по message_id / по uid).
 *
 * Конфиг: IMAP_USER/IMAP_PASS, иначе SMTP_USER/SMTP_PASS (один пароль приложения Яндекса
 * работает и для SMTP, и для IMAP).
 */
import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';

export interface ParsedIncomingEmail {
    messageId: string | null;
    imapUid: number;
    uidValidity: number;
    fromEmail: string | null;
    fromName: string | null;
    toEmail: string | null;
    subject: string | null;
    inReplyTo: string | null;
    references: string | null;
    receivedAt: string | null; // ISO
    bodyText: string | null;
    bodyHtml: string | null;
    hasAttachments: boolean;
    attachmentsMeta: Array<{ filename: string | null; contentType: string | null; size: number | null }>;
}

export interface FetchNewEmailsResult {
    mailbox: string;
    folder: string;
    uidValidity: number;
    lastSeenUidBefore: number;
    maxUidFetched: number;
    emails: ParsedIncomingEmail[];
}

function getImapConfig() {
    const user = process.env.IMAP_USER || process.env.SMTP_USER;
    const pass = process.env.IMAP_PASS || process.env.SMTP_PASS;
    const host = process.env.IMAP_HOST || 'imap.yandex.ru';
    const port = Number(process.env.IMAP_PORT || 993);
    return { user, pass, host, port };
}

export function isImapConfigured(): boolean {
    const { user, pass } = getImapConfig();
    return Boolean(user && pass);
}

function firstAddress(addr: any): { email: string | null; name: string | null } {
    const v = addr?.value?.[0];
    return { email: v?.address ?? null, name: v?.name ?? null };
}

async function parseSource(uid: number, uidValidity: number, source: Buffer): Promise<ParsedIncomingEmail> {
    const parsed = await simpleParser(source);
    const from = firstAddress(parsed.from);
    const to = firstAddress(parsed.to);
    const atts = (parsed.attachments || []).map((a: any) => ({
        filename: a.filename ?? null,
        contentType: a.contentType ?? null,
        size: typeof a.size === 'number' ? a.size : null,
    }));
    return {
        messageId: parsed.messageId ?? null,
        imapUid: uid,
        uidValidity,
        fromEmail: from.email,
        fromName: from.name,
        toEmail: to.email,
        subject: parsed.subject ?? null,
        inReplyTo: (parsed.inReplyTo as string) ?? null,
        references: Array.isArray(parsed.references)
            ? parsed.references.join(' ')
            : (parsed.references as string) ?? null,
        receivedAt: parsed.date ? parsed.date.toISOString() : null,
        bodyText: parsed.text ?? null,
        bodyHtml: typeof parsed.html === 'string' ? parsed.html : null,
        hasAttachments: atts.length > 0,
        attachmentsMeta: atts,
    };
}

export interface EmailContentForForward {
    subject: string | null;
    fromEmail: string | null;
    fromName: string | null;
    receivedAt: string | null; // ISO
    bodyText: string | null;
    bodyHtml: string | null;
    attachments: Array<{ filename: string | null; contentType: string | null; content: Buffer }>;
}

/**
 * Докачивает ПОЛНОЕ письмо по UID вместе с бинарём вложений — для пересылки в отдел.
 * Read-only (BODY.PEEK, \Seen не трогаем). Бинарь вложений мы не храним в БД, поэтому при
 * пересылке берём его прямо из ящика по UID. Возвращает null, если письмо не найдено.
 */
export async function fetchEmailContentByUid(uid: number, folder = 'INBOX'): Promise<EmailContentForForward | null> {
    const { user, pass, host, port } = getImapConfig();
    if (!user || !pass) throw new Error('IMAP config missing (IMAP_USER/IMAP_PASS or SMTP_USER/SMTP_PASS)');

    const client = new ImapFlow({ host, port, secure: true, auth: { user, pass }, logger: false });
    await client.connect();
    const lock = await client.getMailboxLock(folder, { readOnly: true } as any);
    try {
        let source: Buffer | null = null;
        for await (const msg of client.fetch({ uid: String(uid) } as any, { uid: true, source: true } as any, { uid: true } as any)) {
            if ((msg as any).source) source = (msg as any).source as Buffer;
        }
        if (!source) return null;
        const parsed = await simpleParser(source);
        const from = firstAddress(parsed.from);
        const attachments = (parsed.attachments || [])
            .filter((a: any) => a.content)
            .map((a: any) => ({
                filename: a.filename ?? null,
                contentType: a.contentType ?? null,
                content: a.content as Buffer,
            }));
        return {
            subject: parsed.subject ?? null,
            fromEmail: from.email,
            fromName: from.name,
            receivedAt: parsed.date ? parsed.date.toISOString() : null,
            bodyText: parsed.text ?? null,
            bodyHtml: typeof parsed.html === 'string' ? parsed.html : null,
            attachments,
        };
    } finally {
        lock.release();
        await client.logout().catch(() => {});
    }
}

/**
 * Находит имя папки «Отправленные» в ящике: сначала по special-use \Sent,
 * затем по типичным именам Яндекса. Нужна для дозаписи копий исходящих писем,
 * чтобы они появлялись в «Отправленных» и подхватывались почтовой интеграцией RetailCRM.
 */
async function resolveSentFolder(client: ImapFlow): Promise<string | null> {
    try {
        const boxes = await client.list();
        const bySpecial = boxes.find((b: any) => b.specialUse === '\\Sent');
        if (bySpecial) return bySpecial.path;
        const byName = boxes.find((b: any) =>
            ['Отправленные', 'Sent', 'Sent Messages', 'Отправленная почта'].includes(b.path) ||
            ['Отправленные', 'Sent', 'Sent Messages', 'Отправленная почта'].includes(b.name)
        );
        return byName ? byName.path : null;
    } catch {
        return null;
    }
}

/**
 * Дозаписывает копию готового RFC822-письма в папку «Отправленные» ящика (rop@zmktlt.ru),
 * помечая её \Seen. Прямая SMTP-отправка не кладёт копию в Sent сама — без этой дозаписи
 * исходящее не видно ни в веб-почте, ни в RetailCRM (CRM импортирует письма из ящика).
 *
 * Деградирует мягко: при отсутствии конфигурации/папки/ошибке возвращает { appended:false },
 * не бросает — отправку письма это не должно ломать.
 */
export async function appendToSentFolder(raw: Buffer): Promise<{ appended: boolean; folder?: string; error?: string }> {
    const { user, pass, host, port } = getImapConfig();
    if (!user || !pass) return { appended: false, error: 'imap_not_configured' };

    const client = new ImapFlow({ host, port, secure: true, auth: { user, pass }, logger: false });
    try {
        await client.connect();
        const folder = await resolveSentFolder(client);
        if (!folder) return { appended: false, error: 'sent_folder_not_found' };
        await client.append(folder, raw, ['\\Seen']);
        return { appended: true, folder };
    } catch (e: any) {
        return { appended: false, error: e?.message || 'append_failed' };
    } finally {
        await client.logout().catch(() => {});
    }
}

/**
 * Read-only выборка писем, пришедших начиная с указанной даты (IMAP SINCE).
 * Удобно для разовых прогонов/бэкфилла. Флаг \Seen не трогаем.
 */
export async function fetchEmailsSince(since: Date, folder = 'INBOX'): Promise<ParsedIncomingEmail[]> {
    const { user, pass, host, port } = getImapConfig();
    if (!user || !pass) throw new Error('IMAP config missing (IMAP_USER/IMAP_PASS or SMTP_USER/SMTP_PASS)');

    const client = new ImapFlow({ host, port, secure: true, auth: { user, pass }, logger: false });
    const out: ParsedIncomingEmail[] = [];
    await client.connect();
    const lock = await client.getMailboxLock(folder, { readOnly: true } as any);
    try {
        const uidValidity = Number((client.mailbox as any)?.uidValidity ?? 0);
        for await (const msg of client.fetch(
            { since } as any,
            { uid: true, source: true } as any
        )) {
            const uid = Number((msg as any).uid);
            if ((msg as any).source) out.push(await parseSource(uid, uidValidity, (msg as any).source as Buffer));
        }
    } finally {
        lock.release();
        await client.logout().catch(() => {});
    }
    out.sort((a, b) => a.imapUid - b.imapUid);
    return out;
}

/**
 * Забирает новые письма с UID строго больше lastSeenUid (read-only).
 * Если на сервере сменился UIDVALIDITY — указатель невалиден, вызывающий код решает,
 * как поступить (см. email-poll: при смене UIDVALIDITY стартуем от текущего максимума).
 *
 * @param lastSeenUid последний обработанный UID (0 — ящик ещё не читался)
 * @param maxBatch    максимум писем за один проход (защита от первого холодного старта)
 * @param coldStartTailOnly при первом чтении (lastSeenUid=0) не тянуть всю историю, а взять
 *                          только «хвост» из maxBatch последних UID
 */
export async function fetchNewEmails(opts: {
    folder?: string;
    lastSeenUid: number;
    knownUidValidity?: number | null;
    maxBatch?: number;
    coldStartTailOnly?: boolean;
}): Promise<FetchNewEmailsResult> {
    const { user, pass, host, port } = getImapConfig();
    if (!user || !pass) throw new Error('IMAP config missing (IMAP_USER/IMAP_PASS or SMTP_USER/SMTP_PASS)');

    const folder = opts.folder || 'INBOX';
    const maxBatch = opts.maxBatch ?? 50;
    const coldStartTailOnly = opts.coldStartTailOnly ?? true;

    const client = new ImapFlow({
        host,
        port,
        secure: true,
        auth: { user, pass },
        logger: false,
    });

    const emails: ParsedIncomingEmail[] = [];
    let uidValidity = 0;
    let maxUidFetched = opts.lastSeenUid;

    await client.connect();
    // readOnly: true → сервер не выставляет \Seen; дополнительно используем BODY.PEEK ниже.
    const lock = await client.getMailboxLock(folder, { readOnly: true } as any);
    try {
        const mailbox: any = client.mailbox;
        uidValidity = Number(mailbox?.uidValidity ?? 0);
        const uidNext = Number(mailbox?.uidNext ?? 0);

        // Смена UIDVALIDITY: прежний указатель не сопоставим с новыми UID.
        const validityChanged =
            opts.knownUidValidity != null && opts.knownUidValidity !== 0 && opts.knownUidValidity !== uidValidity;

        let startUid = opts.lastSeenUid + 1;

        if (opts.lastSeenUid === 0 || validityChanged) {
            // Холодный старт или сброс: не тянем 159k писем, берём только хвост.
            if (coldStartTailOnly && uidNext > 0) {
                startUid = Math.max(1, uidNext - maxBatch);
            } else {
                startUid = 1;
            }
            // На холодном старте фиксируем точку отсчёта: всё, что было раньше, считаем «уже видели».
            maxUidFetched = Math.max(maxUidFetched, startUid - 1);
        }

        // Диапазон UID. '*' = до последнего. Ограничим объём maxBatch.
        const range = `${startUid}:*`;

        const fetchOpts = {
            uid: true,
            envelope: true,
            source: true, // полный RFC822 → отдадим в mailparser (через BODY.PEEK, \Seen не ставится)
        } as any;

        const collected: Array<{ uid: number; source: Buffer }> = [];
        for await (const msg of client.fetch(range, fetchOpts, { uid: true } as any)) {
            const uid = Number((msg as any).uid);
            if (uid <= opts.lastSeenUid && !(opts.lastSeenUid === 0 || validityChanged)) continue;
            if ((msg as any).source) collected.push({ uid, source: (msg as any).source as Buffer });
        }

        // Сортируем по UID и ограничиваем батч (берём самые свежие, если их больше maxBatch).
        collected.sort((a, b) => a.uid - b.uid);
        const batch = collected.length > maxBatch ? collected.slice(collected.length - maxBatch) : collected;

        for (const { uid, source } of batch) {
            const parsed = await simpleParser(source);
            const from = firstAddress(parsed.from);
            const to = firstAddress(parsed.to);
            const atts = (parsed.attachments || []).map((a) => ({
                filename: a.filename ?? null,
                contentType: a.contentType ?? null,
                size: typeof a.size === 'number' ? a.size : null,
            }));
            emails.push({
                messageId: parsed.messageId ?? null,
                imapUid: uid,
                uidValidity,
                fromEmail: from.email,
                fromName: from.name,
                toEmail: to.email,
                subject: parsed.subject ?? null,
                inReplyTo: (parsed.inReplyTo as string) ?? null,
                references: Array.isArray(parsed.references)
                    ? parsed.references.join(' ')
                    : (parsed.references as string) ?? null,
                receivedAt: parsed.date ? parsed.date.toISOString() : null,
                bodyText: parsed.text ?? null,
                bodyHtml: typeof parsed.html === 'string' ? parsed.html : null,
                hasAttachments: atts.length > 0,
                attachmentsMeta: atts,
            });
            if (uid > maxUidFetched) maxUidFetched = uid;
        }
    } finally {
        lock.release();
        await client.logout().catch(() => {});
    }

    return {
        mailbox: user,
        folder,
        uidValidity,
        lastSeenUidBefore: opts.lastSeenUid,
        maxUidFetched,
        emails,
    };
}
