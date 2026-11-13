/**
 * Письмо клиенту при входе заказа в статус.
 *
 * Доработка №94 (Лена Парфёнова, 13.11.2026): «После перевода в статус
 * ПЕРЕДАНО В ПРОИЗВОДСТВО писать автоматические письма заказчику». В
 * RetailCRM такое письмо слал триггер, у себя делаем так же.
 *
 * Статус в коде не зашит: какой статус шлёт письмо и каким шаблоном —
 * настройка самого статуса (`crm_statuses.client_email_template`), рядом со
 * «Спрашивать причину словами». Завтра такое же письмо понадобится на
 * готовность товара — это галочка, а не правка кода.
 *
 * Письмо не уходит отсюда: собираем его и кладём в ту же очередь, что и
 * отложенные письма менеджера (`email_scheduled_send`). Поэтому смена статуса
 * не ждёт почтовый сервер, а при отказе почты письмо не теряется.
 */
import { supabase } from '@/utils/supabase';
import { safeEnqueueSystemJob } from '@/lib/system-jobs';
import { nextThreadSeq, type LetterToDeliver } from '@/lib/orders/deliver-letter';
import { buildOrderContext, renderTemplate } from '@/lib/templates/render';
import { managerSignature, withSignature } from '@/lib/templates/signature';
import { isNoReplyAddress } from '@/lib/order-mail/recipients';

export type StatusLetterResult =
    | { queued: true; to: string }
    | { queued: false; reason: string };

/**
 * Адрес клиента по заказу.
 *
 * Сначала тот, с кем по заказу уже переписывались: именно туда менеджер и
 * писал «заказ передан в производство». Дальше — почта из самого заказа и из
 * карточки клиента. Автоответчики отсекаем: письмо на `noreply@` не доходит
 * никуда, а в журнале выглядит отправленным (заказ 900454, 05.11.2026).
 */
async function clientAddress(orderNumber: string, orderRow: any): Promise<string | null> {
    const candidates: unknown[] = [];

    const { data: lastSend } = await supabase
        .from('order_email_sends')
        .select('to_email')
        .eq('order_number', orderNumber)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
    candidates.push((lastSend as any)?.to_email);

    const payload = (orderRow?.raw_payload ?? {}) as Record<string, any>;
    candidates.push(orderRow?.email, payload.email);
    for (const contact of (payload.contacts ?? [])) candidates.push(contact?.email);

    const clientId = orderRow?.customer?.id ?? payload.customer?.id;
    if (clientId) {
        const { data: client } = await supabase
            .from('clients')
            .select('email, contact_email')
            .eq('id', clientId)
            .maybeSingle();
        candidates.push((client as any)?.email, (client as any)?.contact_email);
    }

    for (const value of candidates) {
        const address = String(value ?? '').trim().toLowerCase();
        if (address.includes('@') && !isNoReplyAddress(address)) return address;
    }
    return null;
}

/**
 * Поставить письмо клиенту в очередь, если у статуса назначен шаблон.
 *
 * Ничего не бросает: письмо — не причина отменять смену статуса. Второй раз по
 * тому же заказу и статусу письмо не уйдёт — ключ письма тот же, а у
 * `order_email_sends.client_key` уникальный индекс.
 */
export async function queueStatusClientLetter(
    orderRowId: number,
    statusCode: string,
): Promise<StatusLetterResult> {
    try {
        const { data: status } = await supabase
            .from('crm_statuses')
            .select('client_email_template')
            .or(`code.eq.${statusCode},external_code.eq.${statusCode}`)
            .limit(1)
            .maybeSingle();

        const templateCode = String((status as any)?.client_email_template ?? '').trim();
        if (!templateCode) return { queued: false, reason: 'у статуса нет шаблона письма' };

        const { data: template } = await supabase
            .from('email_templates')
            .select('subject, body, mode, active')
            .eq('code', templateCode)
            .maybeSingle();

        // Шаблон удалили или выключили — молчим, но в журнале это видно.
        if (!template || (template as any).active === false) {
            return { queued: false, reason: `шаблон «${templateCode}» не найден или выключен` };
        }
        // Письмо уходит без человека, поэтому только готовый текст: письмо от
        // ИИ никто не вычитывает, а оно уже у клиента.
        if ((template as any).mode === 'ai') {
            return { queued: false, reason: `шаблон «${templateCode}» пишет ИИ — для автописьма не годится` };
        }

        const { data: orderRow } = await supabase
            .from('orders')
            .select('order_id, number, email, customer, manager_id, raw_payload')
            .eq('id', orderRowId)
            .maybeSingle();
        if (!orderRow) return { queued: false, reason: 'заказ не найден' };

        const orderNumber = String((orderRow as any).number ?? (orderRow as any).order_id);

        const to = await clientAddress(orderNumber, orderRow);
        if (!to) return { queued: false, reason: 'у заказа нет почты клиента' };

        const context = await buildOrderContext(orderNumber);
        if (!context) return { queued: false, reason: 'данные заказа для шаблона не собрались' };

        const subject = renderTemplate((template as any).subject, context);
        const body = renderTemplate((template as any).body, context);
        if (!subject.ok || !body.ok) {
            return { queued: false, reason: `шаблон не собрался: ${subject.error || body.error}` };
        }

        const subjectText = String(subject.output ?? '').trim();
        const bodyHtml = String(body.output ?? '').trim();
        // Пустое письмо клиенту хуже, чем отсутствие письма.
        if (!subjectText || !bodyHtml) return { queued: false, reason: 'шаблон собрался пустым' };

        // Подписываем менеджером заказа: человека, который нажал кнопку, у
        // письма после оплаты может и не быть — его ставит робот платежей.
        const signature = await managerSignature((orderRow as any).manager_id);

        const letter: LetterToDeliver = {
            orderNumber,
            orderId: Number((orderRow as any).order_id) || null,
            to,
            subjectText,
            html: withSignature(bodyHtml, signature, true),
            seq: await nextThreadSeq(orderNumber),
            clientKey: `status-letter:${templateCode}:${orderNumber}`,
        };

        const job = await safeEnqueueSystemJob({
            jobType: 'email_scheduled_send',
            payload: { letter, actor: 'Система' },
            priority: 30,
            idempotencyKey: `status_letter:${templateCode}:${orderNumber}`,
            maxAttempts: 5,
        });

        if (!job) return { queued: false, reason: 'очередь писем недоступна' };
        return { queued: true, to };
    } catch (e: any) {
        console.error('[status-letter] письмо клиенту не поставилось в очередь:', e?.message ?? e);
        return { queued: false, reason: String(e?.message ?? e).slice(0, 150) };
    }
}
