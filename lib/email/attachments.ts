/**
 * Вложения писем остаются у нас.
 *
 * Андрей 14.10.2026: «надо значит хранить и вложения». До сих пор мы держали
 * только опись — имя, тип, размер, — а сам файл жил в ящике rop@zmktlt.ru.
 * Пока письмо в ящике, это работало; почистили ящик — вложение потеряно, и в
 * поиске по файлам его нет.
 *
 * Сохраняем отдельным проходом, а не в приёме почты: приём разбирает заявки и
 * заводит заказы, и ронять его из-за тяжёлого вложения нельзя. Проход идёт по
 * письмам, у которых вложения есть, а файлов мы ещё не забрали.
 *
 * Дубли закрыты с двух сторон (Андрей: «тоже важно, чтобы не плодить дубли»):
 * путь в хранилище считается от письма и имени файла, поэтому повтор
 * переписывает тот же объект, а не плодит новый; строка в заказе ставится
 * только если такой же там ещё не лежит.
 */
import { supabase } from '@/utils/supabase';
import { fetchEmailContentByUid, openImapSession } from '@/lib/email/imap';
import { safeStorageSegment } from '@/lib/storage-path';
import { findOrderByOurReply } from '@/lib/order-mail/link';

const BUCKET = 'okk-assets';

/** Больше 25 МБ в заказ не кладём — тот же порог, что у ручной загрузки. */
const MAX_BYTES = 25 * 1024 * 1024;

export type StoredAttachment = {
    filename: string;
    contentType: string | null;
    size: number | null;
    /** Путь в хранилище. Пока его нет, файл есть только в ящике. */
    storagePath?: string;
};

/**
 * Путь считается от письма и имени файла, без времени: повторный проход по
 * тому же письму пишет в тот же объект, а не копит копии.
 */
function storagePath(emailId: number | string, fileName: string): string {
    return `email-files/${safeStorageSegment(String(emailId), 40)}/${safeStorageSegment(fileName)}`;
}

function metaList(meta: unknown): StoredAttachment[] {
    if (!Array.isArray(meta)) return [];
    return meta.map((item: any) => ({
        filename: String(item?.filename ?? '').trim() || 'Без имени',
        contentType: item?.contentType ?? null,
        size: typeof item?.size === 'number' ? item.size : null,
        storagePath: item?.storagePath ?? undefined,
    }));
}

/**
 * Номер заказа письма: по отметке приёма, по уже проставленной связке с
 * заказом или по цепочке ответов.
 *
 * Связку `linked_order_id` ставит приём почты, когда письмо — ответ по
 * существующему заказу. Без неё вложения таких писем оставались без заказа:
 * `findOrderByOurReply` ищет по нашим исходящим, а клиент мог ответить на
 * письмо, которого в этой цепочке нет.
 */
async function orderOfLetter(letter: any): Promise<string | null> {
    if (letter.created_crm_order_number) return String(letter.created_crm_order_number);

    if (letter.linked_order_id) {
        const { data } = await supabase
            .from('orders')
            .select('number')
            .eq('order_id', letter.linked_order_id)
            .maybeSingle();
        if ((data as any)?.number) return String((data as any).number);
    }

    const linked = await findOrderByOurReply(letter);
    return linked ? linked.number : null;
}

/**
 * Записать файл в заказ, если такого там ещё нет. Возвращает, завелась ли
 * новая строка: вызывающий отличает «положили» от «уже было».
 *
 * Наружу эту функцию зовёт докачка вложений по тегу темы
 * (`lib/email/order-files-from-mail.ts`) — писатель в `order_files` один.
 *
 * Проверка плюс уникальный индекс в базе: проверка объясняет человеку, индекс
 * не пускает при одновременных проходах.
 */
export async function attachMailFileToOrder(params: {
    orderNumber: string;
    fileName: string;
    contentType: string | null;
    size: number;
    path: string;
    fromName: string | null;
}): Promise<boolean> {
    const { data: already } = await supabase
        .from('order_files')
        .select('id')
        .eq('order_number', params.orderNumber)
        .eq('file_name', params.fileName)
        .eq('size_bytes', params.size)
        .is('deleted_at', null)
        .limit(1)
        .maybeSingle();

    if (already) return false;

    const { error } = await supabase.from('order_files').insert({
        order_number: params.orderNumber,
        file_name: params.fileName,
        content_type: params.contentType,
        size_bytes: params.size,
        storage_bucket: BUCKET,
        storage_path: params.path,
        note: 'Вложение письма',
        uploaded_by: params.fromName || 'Письмо клиента',
    });

    // Уникальный индекс сработал — значит файл уже в заказе, и это не ошибка.
    if (error && !String(error.message).includes('duplicate key')) {
        console.warn('[email-attachments] файл не записан в заказ:', params.fileName, error.message);
    }

    return !error;
}

export type SaveResult = { letters: number; files: number; skipped: number };

/**
 * Забрать вложения у писем, которые ещё не разобраны.
 *
 * Берём небольшими порциями: вложения тяжёлые, а у крона есть потолок времени.
 */
export async function storePendingAttachments(limit = 10): Promise<SaveResult> {
    const result: SaveResult = { letters: 0, files: 0, skipped: 0 };

    const { data: letters } = await supabase
        .from('incoming_emails')
        .select('id, imap_uid, folder, from_email, from_name, attachments_meta, created_crm_order_number, linked_order_id, in_reply_to, email_refs')
        .eq('has_attachments', true)
        .is('attachments_stored_at', null)
        .order('received_at', { ascending: false })
        .limit(limit);

    /**
     * Одно соединение на весь проход: раньше на каждое письмо открывалось
     * своё, и ящик видел от нас десятки входов в час (см. `openImapSession`).
     */
    const session = await openImapSession();

    try {
        for (const letter of (letters ?? []) as any[]) {
            const uid = Number(letter.imap_uid);
            if (!Number.isFinite(uid)) {
                // Без номера в ящике файл не достать: помечаем разобранным, чтобы
                // проход не упирался в него вечно.
                await supabase.from('incoming_emails')
                    .update({ attachments_stored_at: new Date().toISOString() })
                    .eq('id', letter.id);
                result.skipped += 1;
                continue;
            }

            let content: Awaited<ReturnType<typeof fetchEmailContentByUid>> = null;
            try {
                content = await fetchEmailContentByUid(uid, letter.folder || 'INBOX', session ?? undefined);
            } catch (error) {
                // Ящик недоступен — попробуем в следующий раз, отметку не ставим.
                console.warn('[email-attachments] письмо не прочиталось:', letter.id, error);
                continue;
            }

            if (!content) {
                // Письма в ящике уже нет: его удалили или перенесли. Файлы потеряны,
                // и делать вид, что они есть, не нужно.
                await supabase.from('incoming_emails')
                    .update({ attachments_stored_at: new Date().toISOString() })
                    .eq('id', letter.id);
                result.skipped += 1;
                continue;
            }

            const orderNumber = await orderOfLetter(letter);
            const meta = metaList(letter.attachments_meta);
            const saved: StoredAttachment[] = [];

            for (const attachment of content.attachments) {
                const fileName = String(attachment.filename ?? '').trim() || 'Без имени';
                const bytes = attachment.content;

                if (!bytes?.length || bytes.length > MAX_BYTES) {
                    saved.push({ filename: fileName, contentType: attachment.contentType ?? null, size: bytes?.length ?? null });
                    result.skipped += 1;
                    continue;
                }

                const path = storagePath(letter.id, fileName);
                const upload = await supabase.storage.from(BUCKET).upload(path, new Uint8Array(bytes), {
                    contentType: attachment.contentType || 'application/octet-stream',
                    upsert: true,
                });

                if (upload.error) {
                    console.warn('[email-attachments] файл не сохранился:', fileName, upload.error.message);
                    continue;
                }

                saved.push({
                    filename: fileName,
                    contentType: attachment.contentType ?? null,
                    size: bytes.length,
                    storagePath: path,
                });
                result.files += 1;

                if (orderNumber) {
                    await attachMailFileToOrder({
                        orderNumber,
                        fileName,
                        contentType: attachment.contentType ?? null,
                        size: bytes.length,
                        path,
                        fromName: letter.from_name || letter.from_email || null,
                    });
                }
            }

            /**
             * Опись переписываем сохранённой: в ней те же файлы, но уже с путём в
             * хранилище. Если какое-то вложение забрать не вышло, старая опись
             * остаётся — человек видит, что файл был.
             */
            await supabase
                .from('incoming_emails')
                .update({
                    attachments_meta: saved.length ? saved : meta,
                    attachments_stored_at: new Date().toISOString(),
                })
                .eq('id', letter.id);

            result.letters += 1;
        }
    } finally {
        // Соединение закрываем всегда: брошенная сессия у Яндекса живёт
        // минутами и считается занятой.
        await session?.close();
    }

    return result;
}
