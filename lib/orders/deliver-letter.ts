/**
 * Доставка письма по заказу: собрать вложения, отправить, записать в журнал.
 *
 * Вынесено из маршрута, потому что отправлять нужно из двух мест: когда
 * менеджер нажал «Отправить» и когда наступило время отложенного письма. Двух
 * реализаций отправки быть не должно — письмо уходит наружу, ошибиться тут
 * дороже всего.
 */
import { supabase } from '@/utils/supabase';
import { keepOrderDocument } from '@/lib/orders/keep-document';
import { sendOrderEmail } from '@/lib/email';
import { recordOrderEmailSend } from '@/lib/order-email-log';
import { buildOrderDocumentPdf, loadOrderDocumentData } from '@/lib/own-crm/order-document-pdf';
import { safeStorageSegment } from '@/lib/storage-path';

/** Письмо отправить нельзя, и человеку надо сказать почему. */
export class LetterProblem extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'LetterProblem';
    }
}

export type LetterToDeliver = {
    orderNumber: string;
    orderId?: number | null;
    to: string;
    cc?: string[];
    bcc?: string[];
    subjectText: string;
    html: string;
    seq?: number;
    fromName?: string;
    replyTo?: string;
    /** Файлы, приехавшие прямо в запросе (base64). */
    attachments?: Array<{ filename: string; contentBase64: string; contentType?: string }>;
    /** Что собрать из заказа: КП или счёт. */
    documents?: Array<'proposal' | 'invoice'>;
    /** Номера файлов заказа, которые приложить. */
    orderFileIds?: Array<string | number>;
    clientKey?: string | null;
};

/** КП или счёт по заказу — тем же кодом, что и кнопки в карточке. */
async function buildOrderDocument(
    orderNumber: string,
    kind: 'proposal' | 'invoice',
): Promise<{ filename: string; content: Buffer<ArrayBuffer>; contentType: string } | null> {
    const { data: order } = await supabase
        .from('orders')
        .select('order_id')
        .eq('number', orderNumber)
        .maybeSingle();
    const orderId = Number((order as any)?.order_id ?? orderNumber);
    if (!Number.isFinite(orderId)) return null;

    const data = await loadOrderDocumentData(orderId);
    if (!data) return null;

    const built = await buildOrderDocumentPdf(data, kind);
    return {
        filename: built.fileName,
        content: Buffer.from(new Uint8Array(built.content)),
        contentType: built.contentType,
    };
}

/** Файл из карточки заказа как вложение письма. */
async function orderFileAttachment(
    orderNumber: string,
    fileId: number,
): Promise<{ filename: string; content: Buffer<ArrayBuffer>; contentType: string } | null> {
    const { data: row } = await supabase
        .from('order_files')
        .select('order_number, file_name, content_type, storage_bucket, storage_path')
        .eq('id', fileId)
        .is('deleted_at', null)
        .maybeSingle();
    // Чужой файл к письму не приложим: номер заказа должен совпадать.
    if (!row || String(row.order_number) !== String(orderNumber)) return null;

    const file = await supabase.storage.from(row.storage_bucket || 'okk-assets').download(row.storage_path);
    if (file.error || !file.data) return null;

    return {
        filename: row.file_name,
        content: Buffer.from(new Uint8Array(await file.data.arrayBuffer())),
        contentType: row.content_type || 'application/octet-stream',
    };
}

/** Следующий порядковый номер сообщения в переписке по заказу (по тегам `[#N/order]` во входящих). */
export async function nextThreadSeq(orderNumber: string): Promise<number> {
    try {
        const { data } = await supabase
            .from('incoming_emails')
            .select('subject')
            .ilike('subject', `%/${orderNumber}]%`)
            .limit(200);
        let max = 0;
        for (const row of (data || []) as Array<{ subject: string | null }>) {
            const m = (row.subject || '').match(new RegExp(`\\[#(\\d+)\\/${orderNumber}\\]`));
            if (m) max = Math.max(max, Number(m[1]));
        }
        return max + 1;
    } catch {
        return 1;
    }
}


/** Собрать вложения, отправить письмо и записать его в журнал. */
export async function deliverOrderLetter(body: LetterToDeliver, actor: string | null) {
    const attachments = (body.attachments || []).map((file) => ({
        filename: file.filename,
        content: Buffer.from(file.contentBase64, 'base64'),
        contentType: file.contentType,
    }));

    /**
     * Сколько заняли этапы отправки. Менеджеры жаловались, что письмо уходит
     * долго (Лена Парфёнова 09.10.2026), а разложить это было не на что —
     * теперь в журнале видно, что именно тянет: сборка документов, вложения
     * из хранилища или сам SMTP.
     */
    const timing: Record<string, number> = {};
    let stage = Date.now();

    // КП и счёт собираем здесь же: они делаются из самого заказа, гонять их
    // через браузер незачем.
    for (const kind of body.documents || []) {
        try {
            const pdf = await buildOrderDocument(body.orderNumber, kind);
            /**
             * Документ не собрался — честно останавливаемся.
             *
             * Раньше пустой результат молча пропускался: письмо уходило БЕЗ
             * КП, а менеджер видел «КП приложено ✓» и был уверен, что клиент
             * его получил (Ирина Гордеева 08.10.2026, заказ 900089).
             */
            if (!pdf) {
                throw new LetterProblem(kind === 'invoice'
                    ? 'Счёт по этому заказу не собрался — письмо не отправлено'
                    : 'КП по этому заказу не собралось — письмо не отправлено');
            }
            attachments.push(pdf);
            // Что ушло клиенту — остаётся в файлах заказа: иначе отправленное
            // КП нельзя ни открыть, ни проверить (та же жалоба).
            await keepOrderDocument(body.orderNumber, kind, pdf, actor,
                kind === 'invoice' ? 'Счёт, отправленный письмом' : 'КП, отправленное письмом');
        } catch (e: any) {
            console.error('[send-email] документ не собрался:', kind, e?.message || e);
            throw new LetterProblem(kind === 'invoice'
                ? 'Счёт не собрался — отправьте письмо без него'
                : 'КП не собралось — отправьте письмо без него');
        }
    }

    timing.documents = Date.now() - stage;
    stage = Date.now();

    // Файлы заказа тоже лежат у нас — достаём из хранилища, а не из браузера.
    for (const fileId of body.orderFileIds || []) {
        const file = await orderFileAttachment(body.orderNumber, Number(fileId));
        if (file) attachments.push(file);
    }

    timing.files = Date.now() - stage;
    stage = Date.now();

    const result = await sendOrderEmail({
        to: body.to,
        cc: body.cc,
        bcc: body.bcc,
        orderNumber: body.orderNumber,
        subjectText: body.subjectText,
        html: body.html,
        seq: body.seq,
        fromName: body.fromName,
        replyTo: body.replyTo,
        attachments,
    });

    timing.smtp = Date.now() - stage;

    if (!result.sent) return { ok: false as const, result };

    console.log('[send-email] отправлено', JSON.stringify({
        order: body.orderNumber,
        attachments: attachments.length,
        documents_ms: timing.documents,
        files_ms: timing.files,
        smtp_ms: timing.smtp,
        sent_copy: result.appendQueued ? 'очередь' : result.appendedToSent ? 'сразу' : 'нет',
    }));

    // Фиксируем отправку в реестр (идемпотентность на будущее).
    await recordOrderEmailSend({
        orderNumber: body.orderNumber,
        orderId: body.orderId ?? null,
        toEmail: body.to,
        subject: result.subject,
        messageId: result.messageId,
        appendedToSent: result.appendedToSent,
        sentBy: actor ?? 'неизвестно',
        clientKey: body.clientKey ?? null,
        cc: body.cc ?? null,
        bcc: body.bcc ?? null,
        // Текст кладём сразу: лента переписки иначе ждёт синк «Отправленных»
        // и до тех пор показывает письмо без текста.
        bodyHtml: body.html,
        bodyText: String(body.html || '')
            .replace(/<br\s*\/?>/gi, '\n')
            .replace(/<\/p>/gi, '\n\n')
            .replace(/<[^>]+>/g, '')
            .replace(/&nbsp;/g, ' ')
            .replace(/&amp;/g, '&')
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/\n{3,}/g, '\n\n')
            .trim(),
    });

    // Отправлено, но если копия не легла в Sent — отдаём 200 с предупреждением (письмо ушло клиенту).
    return { ok: true as const, result };
}
