import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getSession } from '@/lib/auth';
import { supabase } from '@/utils/supabase';
import { sendOrderEmail } from '@/lib/email';
import { findSendByClientKey, getLastOrderEmailSend, recordOrderEmailSend } from '@/lib/order-email-log';
import { buildOrderDocumentPdf, loadOrderDocumentData } from '@/lib/own-crm/order-document-pdf';
import { safeStorageSegment } from '@/lib/storage-path';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * Отправка письма по заказу с привязкой к заказу в RetailCRM.
 *
 * Письмо уходит по SMTP и копия дозаписывается в «Отправленные» по IMAP (тег `[#N/NNNNN]`
 * в теме обеспечивает привязку к заказу). IMAP работает из боевого окружения (Vercel),
 * локально в РФ он режется DPI — поэтому это серверный route, а не локальный скрипт.
 *
 * Доступ: admin/rop/ОКК/менеджер — менеджер отвечает клиенту сам, прямо из карточки заказа.
 * Письмо в любом случае уходит с общего ящика компании.
 */

const BodySchema = z.object({
    orderNumber: z.union([z.string(), z.number()]).transform((v) => String(v)),
    to: z.string().email(),
    subjectText: z.string().min(1).max(300),
    html: z.string().min(1),
    seq: z.number().int().positive().optional(),
    fromName: z.string().max(120).optional(),
    replyTo: z.string().email().optional(),
    orderId: z.number().int().positive().optional(),
    force: z.boolean().optional(), // осознанная повторная отправка по уже отправленному заказу
    // Вложения приходят строкой base64: отдельного хранилища для них не нужно,
    // письмо уходит сразу. Ограничение — 15 МБ на всё письмо, дальше почтовые
    // серверы начинают отказывать.
    attachments: z.array(z.object({
        filename: z.string().min(1).max(255),
        contentType: z.string().max(200).optional(),
        contentBase64: z.string().min(1),
    })).max(10).optional(),
    /**
     * Документы по заказу, которые собирает сам сервер: КП и счёт.
     *
     * Раньше карточка скачивала PDF в браузер и отправляла его обратно строкой
     * base64 — вместе с паспортами и сертификатами тело запроса упиралось в
     * лимит, сервер отвечал текстом «Request Entity Too Large», а менеджер
     * видел «Unexpected token 'R'… is not valid JSON» (Ирина 02.10.2026).
     */
    documents: z.array(z.enum(['proposal', 'invoice'])).max(2).optional(),
    /** Человек увидел предупреждение про чужой адрес и подтвердил отправку. */
    allowForeignRecipient: z.boolean().optional(),
    /** Файлы, которые уже лежат в карточке заказа: берём их из хранилища. */
    orderFileIds: z.array(z.number().int().positive()).max(10).optional(),
    /**
     * Ключ письма от браузера: одно нажатие «Отправить» — одно письмо.
     * Повтор того же ключа (двойной щелчок, повтор запроса, отправка при
     * закрытии вкладки) ничего не отправляет второй раз.
     */
    clientKey: z.string().trim().max(100).optional(),
});


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

/**
 * Принадлежит ли адрес клиенту этого заказа.
 *
 * 08.10.2026 письмо по заказу 900081 (ООО «БИР») ушло на почту клиента
 * другого заказа: в адресе страницы залип `replyTo` от прошлого письма.
 * Ответ клиента вернулся по цепочке в чужой заказ, и менеджеры увидели
 * «сдвоенные» заказы. Адрес проверяем по самому заказу, по карточке его
 * клиента и по тем, с кем по заказу уже переписывались.
 */
async function addressBelongsToOrder(orderNumber: string, email: string): Promise<boolean> {
    const target = email.trim().toLowerCase();
    if (!target) return false;

    const { data: order } = await supabase
        .from('orders')
        .select('raw_payload, customer')
        .eq('number', orderNumber)
        .maybeSingle();

    const payload = (order as any)?.raw_payload ?? {};
    const known = new Set<string>();
    const add = (value: unknown) => {
        const text = String(value ?? '').trim().toLowerCase();
        if (text) known.add(text);
    };

    add(payload.email);
    for (const contact of (payload.contacts ?? [])) add(contact?.email);

    const clientId = (order as any)?.customer?.id ?? payload.customer?.id;
    if (clientId) {
        const { data: client } = await supabase
            .from('clients')
            .select('email, contact_email')
            .eq('id', clientId)
            .maybeSingle();
        add((client as any)?.email);
        add((client as any)?.contact_email);
    }

    // С кем уже переписывались по этому заказу — тоже свои.
    const { data: letters } = await supabase
        .from('incoming_emails')
        .select('from_email')
        .eq('created_crm_order_number', orderNumber)
        .limit(50);
    for (const row of ((letters ?? []) as any[])) add(row.from_email);

    return known.has(target);
}

/**
 * Отправленный документ — в файлы заказа.
 *
 * Менеджер должен видеть ИМЕННО ТО, что ушло клиенту: пересобранное заново КП
 * может отличаться (цены, состав), а письмо уже отправлено. Перезаписываем по
 * дате: одно КП в день, иначе список файлов засоряется.
 */
async function keepSentDocument(
    orderNumber: string,
    kind: 'proposal' | 'invoice',
    pdf: { filename: string; content: Buffer; contentType: string },
    author: string | null,
): Promise<void> {
    try {
        const day = new Date().toISOString().slice(0, 10);
        const path = `order-files/${safeStorageSegment(orderNumber, 40)}/sent/${kind}-${day}.pdf`;

        const upload = await supabase.storage.from('okk-assets').upload(path, new Uint8Array(pdf.content), {
            contentType: pdf.contentType,
            upsert: true,
        });
        if (upload.error) {
            console.error('[send-email] документ не лёг в файлы заказа:', upload.error.message);
            return;
        }

        const { data: existing } = await supabase
            .from('order_files')
            .select('id')
            .eq('order_number', orderNumber)
            .eq('storage_path', path)
            .is('deleted_at', null)
            .maybeSingle();

        if (!existing) {
            await supabase.from('order_files').insert({
                order_number: orderNumber,
                file_name: pdf.filename,
                content_type: pdf.contentType,
                size_bytes: pdf.content.length,
                storage_bucket: 'okk-assets',
                storage_path: path,
                note: kind === 'invoice' ? 'Счёт, отправленный письмом' : 'КП, отправленное письмом',
                uploaded_by: author,
            });
        }
    } catch (e: any) {
        // Письмо важнее: провал сохранения его не отменяет.
        console.error('[send-email] документ не сохранился:', e?.message || e);
    }
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
async function nextThreadSeq(orderNumber: string): Promise<number> {
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

export async function POST(req: Request) {
    const session = await getSession();
    if (!session || !['admin', 'rop', 'okk', 'manager'].includes(session.user.role)) {
        return NextResponse.json({ error: 'forbidden' }, { status: 403 });
    }

    let body: z.infer<typeof BodySchema>;
    try {
        body = BodySchema.parse(await req.json());
    } catch (e: any) {
        return NextResponse.json({ error: 'invalid_body', details: e?.errors ?? String(e) }, { status: 400 });
    }

    // Это письмо уже уходило — второй раз не шлём, отвечаем как в первый.
    if (body.clientKey) {
        const already = await findSendByClientKey(body.clientKey);
        if (already) {
            return NextResponse.json({
                ok: true,
                duplicate: true,
                sent: true,
                appendedToSent: true,
                subject: already.subject,
                messageId: already.message_id,
                message: 'Это письмо уже отправлено — второй раз не отправляем.',
            });
        }
    }

    // Идемпотентность: если по заказу уже отправляли письмо — блокируем, пока не передан force.
    if (!body.force) {
        const last = await getLastOrderEmailSend(body.orderNumber);
        if (last) {
            return NextResponse.json(
                { ok: false, error: 'already_sent', lastSentAt: last.created_at, lastTo: last.to_email, lastSubject: last.subject },
                { status: 409 }
            );
        }
    }

    /**
     * Чужой адресат — останавливаемся. Человек подтверждает отправку явно
     * (`allowForeignRecipient`), и тогда письмо уходит, куда он решил.
     */
    if (!body.allowForeignRecipient && !(await addressBelongsToOrder(body.orderNumber, body.to))) {
        return NextResponse.json(
            {
                ok: false,
                error: 'foreign_recipient',
                message: `Адрес ${body.to} не числится за клиентом заказа №${body.orderNumber}. Проверьте, тому ли вы пишете.`,
            },
            { status: 409 },
        );
    }

    const seq = body.seq ?? (await nextThreadSeq(body.orderNumber));

    const totalBytes = (body.attachments || [])
        .reduce((sum, file) => sum + Math.ceil(file.contentBase64.length * 3 / 4), 0);
    if (totalBytes > 15 * 1024 * 1024) {
        return NextResponse.json(
            { ok: false, error: 'Вложения тяжелее 15 МБ — почта такое письмо не примет' },
            { status: 413 },
        );
    }

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
                return NextResponse.json(
                    { ok: false, error: kind === 'invoice' ? 'Счёт по этому заказу не собрался — письмо не отправлено' : 'КП по этому заказу не собралось — письмо не отправлено' },
                    { status: 400 },
                );
            }
            attachments.push(pdf);
            // Что ушло клиенту — остаётся в файлах заказа: иначе отправленное
            // КП нельзя ни открыть, ни проверить (та же жалоба).
            await keepSentDocument(body.orderNumber, kind, pdf, session.user.email || session.user.username || null);
        } catch (e: any) {
            console.error('[send-email] документ не собрался:', kind, e?.message || e);
            return NextResponse.json(
                { ok: false, error: kind === 'invoice' ? 'Счёт не собрался — отправьте письмо без него' : 'КП не собралось — отправьте письмо без него' },
                { status: 400 },
            );
        }
    }

    timing.documents = Date.now() - stage;
    stage = Date.now();

    // Файлы заказа тоже лежат у нас — достаём из хранилища, а не из браузера.
    for (const fileId of body.orderFileIds || []) {
        const file = await orderFileAttachment(body.orderNumber, fileId);
        if (file) attachments.push(file);
    }

    timing.files = Date.now() - stage;
    stage = Date.now();

    const result = await sendOrderEmail({
        to: body.to,
        orderNumber: body.orderNumber,
        subjectText: body.subjectText,
        html: body.html,
        seq,
        fromName: body.fromName,
        replyTo: body.replyTo,
        attachments,
    });

    timing.smtp = Date.now() - stage;

    if (!result.sent) {
        return NextResponse.json({ ok: false, ...result }, { status: 502 });
    }

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
        sentBy: session.user.email || session.user.role,
        clientKey: body.clientKey ?? null,
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
    return NextResponse.json({ ok: true, ...result });
}
