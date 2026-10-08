import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getSession } from '@/lib/auth';
import { supabase } from '@/utils/supabase';
import { loadOrderThreads } from '@/lib/order-mail/load';
import { stateLabel, visibleBody } from '@/lib/order-mail/thread';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * Переписка по заказу тредами — раздел «Переписка» в карточке заказа.
 *
 * Постановка: `docs/order-mail/TZ.md`. Письма лежат в трёх таблицах, тред
 * собирается на лету (`lib/order-mail/thread.ts`); здесь только чтение, права
 * и перевод на человеческий язык.
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: 'Неавторизован' }, { status: 401 });

    const { id } = await params;
    const orderNumber = decodeURIComponent(String(id));

    // Номер своего заказа — число, но НЕ идентификатор (900089 против
    // 900000089): сначала ищем по номеру (грабля 08.10.2026).
    const { data: order } = await supabase
        .from('orders')
        .select('order_id')
        .eq('number', orderNumber)
        .maybeSingle();

    const viewer = session.user.email || session.user.username || session.user.id;

    const { threads, unread, total } = await loadOrderThreads({
        orderNumber,
        orderId: (order as any)?.order_id ?? null,
        viewer,
        limit: Number(new URL(req.url).searchParams.get('limit') || 100),
    });

    return NextResponse.json({
        ok: true,
        unread,
        total,
        threads: threads.map((thread) => ({
            key: thread.key,
            subject: thread.subject,
            state: thread.state,
            // Человеческий язык: кодов в интерфейсе быть не должно.
            stateLabel: stateLabel(thread.state),
            lastAt: thread.lastAt,
            unread: thread.unread,
            participants: thread.participants,
            messages: thread.messages.map((message) => {
                const { text, quoted } = visibleBody(message);
                return {
                    key: message.key,
                    direction: message.direction,
                    subject: message.subject,
                    from: message.from,
                    fromName: message.fromName,
                    to: message.to,
                    at: message.at,
                    text,
                    // Цитата едет отдельно: в ленте она свёрнута.
                    quoted,
                    attachments: message.attachments,
                    emailId: message.direction === 'in' ? message.sourceId : null,
                    read: message.read,
                };
            }),
        })),
    });
}

const ActionSchema = z.discriminatedUnion('action', [
    z.object({ action: z.literal('read'), messageKeys: z.array(z.string().max(64)).max(200) }),
    z.object({ action: z.literal('close'), threadKey: z.string().max(400) }),
    z.object({ action: z.literal('reopen'), threadKey: z.string().max(400) }),
]);

/** Отметить письма прочитанными, закрыть тред или вернуть его в работу. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: 'Неавторизован' }, { status: 401 });

    const { id } = await params;
    const orderNumber = decodeURIComponent(String(id));

    const parsed = ActionSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: 'Непонятное действие' }, { status: 400 });

    const who = session.user.email || session.user.username || session.user.id;

    if (parsed.data.action === 'read') {
        if (!parsed.data.messageKeys.length) return NextResponse.json({ ok: true });
        // Повторная отметка не плодит строк — ключ уникален по письму и человеку.
        const { error } = await supabase
            .from('order_mail_reads')
            .upsert(
                parsed.data.messageKeys.map((key) => ({ message_key: key, order_number: orderNumber, read_by: who })),
                { onConflict: 'message_key,read_by' },
            );
        if (error) {
            console.error('[order-mail] прочитанность не записалась:', error.message);
            return NextResponse.json({ error: 'Не записалось' }, { status: 500 });
        }
        return NextResponse.json({ ok: true });
    }

    const closing = parsed.data.action === 'close';
    const { error } = await supabase
        .from('order_mail_threads')
        .upsert(
            {
                order_number: orderNumber,
                thread_key: parsed.data.threadKey,
                state: closing ? 'closed' : 'open',
                closed_by: closing ? who : null,
                closed_at: closing ? new Date().toISOString() : null,
                updated_at: new Date().toISOString(),
            },
            { onConflict: 'order_number,thread_key' },
        );

    if (error) {
        console.error('[order-mail] состояние треда не записалось:', error.message);
        return NextResponse.json({ error: 'Не сохранилось' }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
}
