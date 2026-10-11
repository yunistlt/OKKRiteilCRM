import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getSession } from '@/lib/auth';
import { supabase } from '@/utils/supabase';
import { findSendByClientKey, getLastOrderEmailSend } from '@/lib/order-email-log';
import { deliverOrderLetter, LetterProblem, nextThreadSeq } from '@/lib/orders/deliver-letter';
import { safeEnqueueSystemJob } from '@/lib/system-jobs';

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
    /** Копия и скрытая копия: со стороны клиента в переписке обычно несколько человек. */
    cc: z.array(z.string().trim().email()).max(20).optional(),
    bcc: z.array(z.string().trim().email()).max(20).optional(),
    /**
     * Когда отправить. Пусто — сейчас. Время в будущем ставит письмо в
     * очередь: уйдёт само, даже если ОКК закрыт и компьютер выключен.
     */
    sendAt: z.string().datetime({ offset: true }).optional(),
    clientKey: z.string().trim().max(100).optional(),
});


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

    /**
     * Отложенная отправка (ТЗ §4).
     *
     * Письмо не держим в браузере: человек уйдёт домой, и оно не уедет.
     * Кладём в очередь задач — её разбирает крон, и письмо уходит само.
     * Повтора не будет: ключ письма тот же, что при обычной отправке.
     */
    if (body.sendAt) {
        const when = new Date(body.sendAt);
        if (when.getTime() > Date.now() + 30_000) {
            const job = await safeEnqueueSystemJob({
                jobType: 'email_scheduled_send',
                payload: { letter: { ...body, seq }, actor: session.user.email || session.user.username || session.user.role },
                priority: 30,
                idempotencyKey: body.clientKey ? `email_scheduled_send:${body.clientKey}` : undefined,
                availableAt: when.toISOString(),
                maxAttempts: 5,
            });

            if (job) {
                return NextResponse.json({
                    ok: true,
                    scheduled: true,
                    sendAt: when.toISOString(),
                    message: `Письмо уйдёт ${when.toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' })}. До этого времени его можно отменить в заказе.`,
                });
            }

            // Очередь недоступна — честно говорим, а не отправляем сейчас:
            // человек выбрал другое время осознанно.
            return NextResponse.json(
                { ok: false, error: 'Отложенная отправка сейчас недоступна — отправьте письмо сразу или попробуйте позже' },
                { status: 503 },
            );
        }
    }

    let delivery;
    try {
        delivery = await deliverOrderLetter(
            { ...body, seq },
            session.user.email || session.user.username || session.user.role,
        );
    } catch (e: any) {
        if (e instanceof LetterProblem) {
            return NextResponse.json({ ok: false, error: e.message }, { status: 400 });
        }
        throw e;
    }

    const result = delivery.result;
    if (!delivery.ok) {
        return NextResponse.json({ ok: false, ...result }, { status: 502 });
    }

    return NextResponse.json({ ok: true, ...result });
}
