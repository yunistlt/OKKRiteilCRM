import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { supabase } from '@/utils/supabase';
import { stripOrderThreadTag } from '@/lib/email';

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

        const last = thread[0] || null;

        // Адресат из заказа — на случай, когда клиент ещё не писал.
        const { data: order } = await supabase
            .from('orders')
            .select('raw_payload')
            .eq('order_id', orderNumber)
            .maybeSingle();

        const payload = (order?.raw_payload ?? {}) as any;
        const orderEmail = payload.email || payload.contact?.email || payload.customer?.email || null;

        return NextResponse.json({
            to: last?.from_email || orderEmail || null,
            toName: last?.from_name || null,
            subjectText: stripOrderThreadTag(last?.subject || '') || `По заказу №${orderNumber}`,
            hasThread: thread.length > 0,
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
