/**
 * Докачать вложения писем по заказу прямо из ящика — по тегу темы.
 *
 * Зачем: у старых заказов файлы есть только в письмах. По заказу 52709
 * (26.10.2026) в RetailCRM видно восемь файлов, а в файловом API их два —
 * остальные шесть это вложения писем, и наружу RetailCRM их не отдаёт.
 * Разбор вложений (`lib/email/attachments.ts`) берёт только те письма, что
 * уже лежат у нас в `incoming_emails`, а архив начинается с 28.06.2026.
 *
 * Поэтому идём в ящик точечно по одной сделке и ищем не по адресам клиента, а
 * по нашему служебному тегу темы `[#N/<номер>]`: тег стоит и в наших письмах,
 * и в ответах клиента, так что находится вся ветка по заказу и ничего чужого.
 *
 * Берём INBOX и «Отправленные»: счёт и КП уходили от нас, ТЗ и реквизиты
 * приходили от клиента — нужны обе стороны.
 *
 * Ящик читается read-only, флаг «прочитано» не трогаем. Писем в базу НЕ
 * заводим: здесь речь только о файлах заказа, переписку поднимает отдельная
 * кнопка «Загрузить историю» (`lib/email/history-import.ts`).
 *
 * Локально не работает: IMAP из РФ режет DPI — проверять на проде.
 */
import { supabase } from '@/utils/supabase';
import { openImapSession, findSentFolder, isImapConfigured } from '@/lib/email/imap';
import { safeStorageSegment } from '@/lib/storage-path';
import { attachMailFileToOrder } from '@/lib/email/attachments';
import { simpleParser } from 'mailparser';

const BUCKET = 'okk-assets';

/** Тот же порог, что у ручной загрузки файла в заказ. */
const MAX_BYTES = 25 * 1024 * 1024;

/** Потолок писем на папку: длинная переписка не должна упираться в время маршрута. */
const MAX_MESSAGES = 100;

export type OrderFilesFromMailResult = {
    ok: boolean;
    /** Почему не вышло — человеческим языком, это уходит прямо в интерфейс. */
    error?: string;
    /** Сколько писем с вложениями нашлось по тегу. */
    letters: number;
    /** Сколько файлов легло в заказ. */
    added: number;
    /** Сколько файлов уже были в заказе или не прошли по размеру. */
    skipped: number;
};

/**
 * Путь считается от папки, UID письма и имени файла: повторный заход пишет в
 * тот же объект, а не копит копии.
 */
function storagePath(orderNumber: string, folder: string, uid: number, fileName: string): string {
    const box = safeStorageSegment(folder, 20);
    return `order-files/${safeStorageSegment(orderNumber, 40)}/mail/${box}-${uid}-${safeStorageSegment(fileName)}`;
}

/**
 * Файлы одного письма.
 *
 * Картинки подписи отбрасываем: в письме они такие же вложения, но файлом
 * заказа логотип и кнопка каталога не являются — иначе после докачки список
 * файлов заказа забьётся ими.
 */
function realAttachments(parsed: any): Array<{ filename: string; contentType: string | null; content: Buffer }> {
    return (parsed.attachments || [])
        .filter((a: any) => a.content && !a.related)
        .map((a: any) => ({
            filename: String(a.filename ?? '').trim() || 'Без имени',
            contentType: a.contentType ?? null,
            content: a.content as Buffer,
        }));
}

/** UID писем папки, у которых в теме стоит наш тег этого заказа. */
async function uidsByTag(client: any, folder: string, orderNumber: string): Promise<number[]> {
    const lock = await client.getMailboxLock(folder, { readOnly: true } as any);
    try {
        // Ищем по куску тега `/<номер>]`: он отсекает и чужие заказы, и номер,
        // случайно попавший в текст темы.
        // Поиск иногда отвечает `false`, когда ящик отбивается от напора.
        const answer = await client
            .search({ header: { subject: `/${orderNumber}]` } } as any, { uid: true } as any)
            .catch(() => null);
        const found: number[] = Array.isArray(answer) ? answer : [];
        // Самые свежие вперёд: у длинной переписки забираем хвост.
        return Array.from(new Set(found.map(Number)))
            .sort((a, b) => b - a)
            .slice(0, MAX_MESSAGES);
    } finally {
        lock.release();
    }
}

/** Разобрать письма папки и положить их вложения в заказ. */
async function pullFolder(params: {
    client: any;
    folder: string;
    orderNumber: string;
    result: OrderFilesFromMailResult;
}): Promise<void> {
    const { client, folder, orderNumber, result } = params;

    const uids = await uidsByTag(client, folder, orderNumber);
    if (!uids.length) return;

    const lock = await client.getMailboxLock(folder, { readOnly: true } as any);
    try {
        for await (const msg of client.fetch(uids, { uid: true, source: true } as any, { uid: true } as any)) {
            const uid = Number((msg as any).uid);
            const source = (msg as any).source as Buffer | undefined;
            if (!source) continue;

            const parsed = await simpleParser(source);
            const files = realAttachments(parsed);
            if (!files.length) continue;
            result.letters += 1;

            const from = (parsed.from as any)?.value?.[0] ?? {};
            const author = String(from.name || from.address || '').trim() || 'Письмо';

            for (const file of files) {
                if (!file.content.length || file.content.length > MAX_BYTES) {
                    result.skipped += 1;
                    continue;
                }

                const path = storagePath(orderNumber, folder, uid, file.filename);
                const upload = await supabase.storage.from(BUCKET).upload(path, new Uint8Array(file.content), {
                    contentType: file.contentType || 'application/octet-stream',
                    upsert: true,
                });

                if (upload.error) {
                    console.warn('[order-files-from-mail] файл не сохранился:', file.filename, upload.error.message);
                    result.skipped += 1;
                    continue;
                }

                const written = await attachMailFileToOrder({
                    orderNumber,
                    fileName: file.filename,
                    contentType: file.contentType,
                    size: file.content.length,
                    path,
                    fromName: author,
                });

                if (written) result.added += 1;
                else result.skipped += 1;
            }
        }
    } finally {
        lock.release();
    }
}

/**
 * Докачать в заказ все вложения писем с его тегом в теме.
 *
 * Одно соединение с ящиком на весь заход: вход — самая дорогая часть работы, и
 * Яндекс считает именно сессии (см. `openImapSession`).
 */
export async function importOrderFilesFromMail(orderNumber: string): Promise<OrderFilesFromMailResult> {
    const result: OrderFilesFromMailResult = { ok: false, letters: 0, added: 0, skipped: 0 };

    if (!isImapConfigured()) {
        return { ...result, error: 'Доступ к почтовому ящику не настроен' };
    }

    const sentFolder = await findSentFolder();
    const session = await openImapSession();
    if (!session) {
        return { ...result, error: 'Почтовый ящик не отвечает' };
    }

    try {
        for (const folder of ['INBOX', sentFolder].filter(Boolean) as string[]) {
            await pullFolder({ client: session.client, folder, orderNumber, result });
        }
        return { ...result, ok: true };
    } catch (e: any) {
        console.error('[order-files-from-mail] заход не удался:', e?.message || e);
        return { ...result, error: `Почта не отдала вложения: ${e?.message || e}` };
    } finally {
        // Брошенная сессия у Яндекса живёт минутами и считается занятой.
        await session.close();
    }
}
