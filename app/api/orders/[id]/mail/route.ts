import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getSession } from '@/lib/auth';
import { supabase } from '@/utils/supabase';
import { loadOrderThreads } from '@/lib/order-mail/load';
import { stateLabel, visibleBody } from '@/lib/order-mail/thread';
import { summarizeThread } from '@/lib/order-mail/summary';

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

    /**
     * Письма, назначенные на будущее: их видно рядом с перепиской, и до
     * срока их можно отменить. Иначе отложенное письмо уходит сюрпризом.
     */
    const { data: waiting } = await supabase
        .from('system_jobs')
        .select('id, payload, available_at')
        .eq('job_type', 'email_scheduled_send')
        .eq('status', 'queued')
        .order('available_at');

    const scheduled = ((waiting ?? []) as any[])
        .filter((job) => String(job.payload?.letter?.orderNumber ?? '') === orderNumber)
        .map((job) => ({
            jobId: String(job.id),
            sendAt: job.available_at,
            to: job.payload?.letter?.to ?? null,
            subject: job.payload?.letter?.subjectText ?? null,
        }));

    return NextResponse.json({
        ok: true,
        unread,
        total,
        scheduled,
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
                    // Кто ещё в переписке: по ним работает «ответить всем».
                    toAll: message.toAll,
                    cc: message.cc,
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
    /** Отменить отложенное письмо, пока оно не ушло. */
    z.object({ action: z.literal('cancel-scheduled'), jobId: z.string().max(64) }),
    /** «О чём договорились» — краткое изложение разговора (ТЗ §6). */
    z.object({ action: z.literal('summary'), threadKey: z.string().max(400) }),
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

    const command = parsed.data;

    if (command.action === 'summary') {
        /**
         * Помощник, а не действие: собирает изложение и отдаёт его человеку.
         * Ничего не отправляет и в заказе не меняет.
         */
        const { data: order } = await supabase
            .from('orders')
            .select('order_id')
            .eq('number', orderNumber)
            .maybeSingle();

        const { threads } = await loadOrderThreads({
            orderNumber,
            orderId: (order as any)?.order_id ?? null,
            viewer: who,
            limit: 100,
        });

        const thread = threads.find((item) => item.key === command.threadKey);
        if (!thread) return NextResponse.json({ error: 'Разговор не найден' }, { status: 404 });

        try {
            return NextResponse.json({ ok: true, summary: await summarizeThread(thread.messages) });
        } catch (e: any) {
            return NextResponse.json({ error: e?.message ?? 'Изложение не собралось' }, { status: 502 });
        }
    }

    if (parsed.data.action === 'cancel-scheduled') {
        /**
         * Снимаем задачу, пока её не взял воркер. Если взял — письмо уже
         * уходит, и врать «отменили» нельзя.
         */
        const { data: job } = await supabase
            .from('system_jobs')
            .select('id, status, payload')
            .eq('id', parsed.data.jobId)
            .maybeSingle();

        if (!job) return NextResponse.json({ error: 'Письмо не найдено' }, { status: 404 });

        if (String((job as any).payload?.letter?.orderNumber ?? '') !== orderNumber) {
            return NextResponse.json({ error: 'Это письмо не по этому заказу' }, { status: 403 });
        }

        if (String((job as any).status) !== 'queued') {
            return NextResponse.json(
                { error: 'Письмо уже отправляется — отменить поздно' },
                { status: 409 },
            );
        }

        const { error: cancelError } = await supabase
            .from('system_jobs')
            .update({
                status: 'completed',
                finished_at: new Date().toISOString(),
                result: { status: 'отменено человеком', by: who },
                updated_at: new Date().toISOString(),
            })
            .eq('id', parsed.data.jobId)
            .eq('status', 'queued');

        if (cancelError) {
            return NextResponse.json({ error: `Не удалось отменить: ${cancelError.message}` }, { status: 500 });
        }

        return NextResponse.json({ ok: true, message: 'Отложенное письмо отменено — оно не уйдёт.' });
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
