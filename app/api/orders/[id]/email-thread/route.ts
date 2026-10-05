import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { supabase } from '@/utils/supabase';
import { stripOrderThreadTag } from '@/lib/email';
import { isNoReplySender } from '@/lib/email/classify';

export const dynamic = 'force-dynamic';

/**
 * Данные для ответа клиенту по заказу: кому писать, с какой темой и что было в переписке.
 *
 * Почта у нас одна на всю компанию (rop@zmktlt.ru), поэтому нить держится не адресом
 * ящика, а служебным тегом `[#N/NNNNN]` в теме и адресом контрагента. Отсюда и логика:
 * адресата и тему берём из ПОСЛЕДНЕГО письма клиента по этому заказу, а если переписки
 * ещё не было — из самого заказа.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
    const session = await getSession();
    if (!session) {
        return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }

    const { id } = await params;
    const orderNumber = String(id);

    try {
        const { data: letters } = await supabase
            .from('incoming_emails')
            .select('from_email, from_name, subject, received_at, body_text')
            .or(`created_crm_order_number.eq.${orderNumber},subject.ilike.%/${orderNumber}]%`)
            .order('received_at', { ascending: false })
            .limit(20);

        const thread = (letters || []) as Array<{
            from_email: string | null;
            from_name: string | null;
            subject: string | null;
            received_at: string | null;
            body_text: string | null;
        }>;

        // Исходящие письма живут в своём журнале — без них переписка выглядит
        // односторонней: видно, что писал клиент, и не видно, что ответили мы.
        const { data: sent } = await supabase
            .from('order_email_sends')
            .select('to_email, subject, created_at, sent_by')
            .eq('order_number', orderNumber)
            .order('created_at', { ascending: false })
            .limit(20);

        const outgoing = (sent || []).map((row: any) => ({
            direction: 'исходящее' as const,
            party: row.to_email as string | null,
            partyName: null as string | null,
            subject: row.subject as string | null,
            at: row.created_at as string | null,
            preview: row.sent_by ? `Отправил: ${row.sent_by}` : '',
        }));

        const incoming = thread.map((m) => ({
            direction: 'входящее' as const,
            party: m.from_email,
            partyName: m.from_name,
            subject: m.subject,
            at: m.received_at,
            preview: (m.body_text || '').replace(/\s+/g, ' ').slice(0, 200),
        }));

        const conversation = [...incoming, ...outgoing]
            .sort((a, b) => new Date(b.at || 0).getTime() - new Date(a.at || 0).getTime());

        /**
         * Кому отвечать.
         *
         * Берём последнее письмо ЖИВОГО отправителя. Заказ из корзины сайта
         * заводит письмо-робот (`noreply@webasyst.biz`), и раньше именно его
         * адрес подставлялся в «Кому» — менеджер правил руками, а мог и не
         * заметить и отправить коммерческое предложение роботу (жалоба
         * Евгении 05.10.2026, заказ 900057: в карточке стоит почта клиента
         * engineer_111@mail.ru). Таких заказов 63.
         */
        const last = thread.find((m) => !isNoReplySender(m.from_email)) || null;

        // Адресат из заказа — на случай, когда клиент ещё не писал.
        // Ищем по НОМЕРУ заказа: в маршрут приходит именно он («1038А»), а не
        // числовой order_id. Раньше условие стояло на order_id, заказ не находился,
        // и у заявки без переписки поле «Кому» оставалось пустым.
        const { data: order } = await supabase
            .from('orders')
            .select('email, manager_id, raw_payload')
            .eq('number', orderNumber)
            .maybeSingle();

        const payload = (order?.raw_payload ?? {}) as any;
        const orderEmailRaw =
            (order as any)?.email || payload.email || payload.contact?.email || payload.customer?.email || null;
        // Заявка с формы сайта приходит без почты клиента, и в заказ попадает
        // адрес робота. Лучше оставить «Кому» пустым — менеджер впишет сам, чем
        // подставить адрес, на который нельзя писать.
        const orderEmail = isNoReplySender(orderEmailRaw) ? null : orderEmailRaw;

        // Подпись менеджера — та же, что в RetailCRM: имя из справочника менеджеров,
        // добавочный — из его настроек Телфина (там, где он уже заполнен).
        const { data: manager } = (order as any)?.manager_id
            ? await supabase
                  .from('managers')
                  .select('first_name, last_name, telphin_extension')
                  .eq('id', (order as any).manager_id)
                  .maybeSingle()
            : { data: null };

        const managerName = [manager?.last_name, manager?.first_name].filter(Boolean).join(' ').trim();
        const extension = manager?.telphin_extension ? String(manager.telphin_extension).trim() : '';
        const signature = managerName
            ? [
                  'С уважением,',
                  managerName,
                  'Менеджер по продажам',
                  'Завод Металлических Конструкций',
                  `+7(499)350-44-90${extension ? `, ${extension}` : ''}`,
                  'https://zmktlt.ru/',
              ].join('\n')
            : null;

        return NextResponse.json({
            to: last?.from_email || orderEmail || null,
            signature,
            toName: last?.from_name || null,
            subjectText: stripOrderThreadTag(last?.subject || '') || `По заказу №${orderNumber}`,
            hasThread: conversation.length > 0,
            // Переписка целиком: и что писал клиент, и что отвечали мы.
            conversation: conversation.slice(0, 20),
            thread: thread.slice(0, 5).map((m) => ({
                from: m.from_email,
                fromName: m.from_name,
                subject: m.subject,
                receivedAt: m.received_at,
                preview: (m.body_text || '').replace(/\s+/g, ' ').slice(0, 200),
            })),
        });
    } catch (e: any) {
        console.error('[email-thread] Не удалось собрать переписку по заказу:', e);
        return NextResponse.json({ error: 'thread_lookup_failed' }, { status: 500 });
    }
}
