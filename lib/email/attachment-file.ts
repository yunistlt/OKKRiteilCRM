/**
 * Вложение входящего письма — достать и отдать браузеру.
 *
 * Бинарь вложений мы не храним: письма читаются read-only. При первом
 * обращении файл докачивается из ящика по UID письма и кладётся в наше
 * хранилище, дальше отдаётся уже оттуда — второй раз в почту не ходим.
 *
 * Открывают вложение двумя путями: из карточки заказа (файл становится файлом
 * заказа) и из раздела «Письма» — в том числе у письма, которое к заказу не
 * привязано (жалоба 23.11.2026: «как посмотреть вложения, если письмо без
 * заказа»). Логика забора одна, поэтому она здесь, а маршруты только решают,
 * кому и куда.
 */
import { NextResponse } from 'next/server';
import { supabase } from '@/utils/supabase';
import { fetchEmailContentByUid, isImapConfigured } from '@/lib/email/imap';
import { fileContentType, isViewableInBrowser } from '@/lib/file-type';

export const ATTACHMENT_BUCKET = 'okk-assets';

/**
 * Заголовки показа файла.
 *
 * Тип считаем по самому файлу, а не по записи в базе: у вложений, долитых из
 * RetailCRM, тип не был известен и лёг «просто байтами», с которыми браузер
 * всегда скачивает, даже когда мы просим `inline`. Что показать во вкладке, а
 * что отдать на сохранение, решает уже тип: картинку и PDF человек хочет
 * увидеть, таблицу — открыть у себя.
 */
export function fileHeaders(fileName: string, bytes: Uint8Array, storedType?: string | null): HeadersInit {
    const known = String(storedType ?? '').trim();
    const contentType = known && known !== 'application/octet-stream'
        ? known
        : fileContentType(fileName, bytes);

    const how = isViewableInBrowser(contentType) ? 'inline' : 'attachment';

    return {
        'Content-Type': contentType,
        'Content-Disposition': `${how}; filename*=UTF-8''${encodeURIComponent(fileName)}`,
        'Cache-Control': 'private, max-age=600',
    };
}

/** Имя файла для пути в хранилище: латиницу не трогаем, остальное чистим. */
export function safeStorageName(filename: string): string {
    return filename.replace(/[^\w.\-]+/g, '_').slice(-120) || 'file';
}

export type MailLetter = { imap_uid: number | string | null; folder: string | null };

export type LoadedAttachment =
    | { ok: true; bytes: Uint8Array<ArrayBuffer>; contentType: string; fromMailbox: boolean; receivedAt: string | null }
    | { ok: false; response: NextResponse };

/**
 * Файл письма: из нашего хранилища, а если там ещё нет — из ящика с
 * сохранением в хранилище по `path`.
 */
export async function loadLetterAttachment(
    letter: MailLetter,
    filename: string,
    path: string,
): Promise<LoadedAttachment> {
    // 1) Уже скачивали — отдаём из хранилища.
    const cached = await supabase.storage.from(ATTACHMENT_BUCKET).download(path);
    if (cached.data) {
        return {
            ok: true,
            bytes: new Uint8Array(await cached.data.arrayBuffer()),
            contentType: cached.data.type,
            fromMailbox: false,
            receivedAt: null,
        };
    }

    // 2) Иначе качаем из ящика по UID письма.
    if (!isImapConfigured() || !letter.imap_uid) {
        return {
            ok: false,
            response: NextResponse.json(
                { error: 'Файл остался в почте, а доступ к ящику не настроен — открыть нельзя' },
                { status: 409 },
            ),
        };
    }

    try {
        const mail = await fetchEmailContentByUid(Number(letter.imap_uid), String(letter.folder || 'INBOX'));
        const attachment = (mail?.attachments ?? []).find(
            (a) => String(a.filename ?? '').trim() === filename.trim(),
        ) ?? (mail?.attachments ?? [])[0];

        if (!attachment?.content) {
            return { ok: false, response: NextResponse.json({ error: 'В письме такого вложения уже нет' }, { status: 404 }) };
        }

        const contentType = attachment.contentType || 'application/octet-stream';
        await supabase.storage
            .from(ATTACHMENT_BUCKET)
            .upload(path, attachment.content, { contentType, upsert: true })
            .catch(() => undefined);

        return {
            ok: true,
            bytes: new Uint8Array(attachment.content),
            contentType,
            fromMailbox: true,
            receivedAt: mail?.receivedAt ?? null,
        };
    } catch (e: any) {
        console.error('[email-attachment] не смог забрать вложение:', e.message);
        return {
            ok: false,
            response: NextResponse.json({ error: `Не удалось забрать файл из почты: ${e.message}` }, { status: 502 }),
        };
    }
}
