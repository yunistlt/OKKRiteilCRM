import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getSession } from '@/lib/auth';
import { supabase } from '@/utils/supabase';
import { sendOrderEmail } from '@/lib/email';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * Отправка письма по заказу с привязкой к заказу в RetailCRM.
 *
 * Письмо уходит по SMTP и копия дозаписывается в «Отправленные» по IMAP (тег `[#N/NNNNN]`
 * в теме обеспечивает привязку к заказу). IMAP работает из боевого окружения (Vercel),
 * локально в РФ он режется DPI — поэтому это серверный route, а не локальный скрипт.
 *
 * Доступ: сессия admin/rop (route под middleware-защитой, нужна авторизация в приложении).
 */

const BodySchema = z.object({
    orderNumber: z.union([z.string(), z.number()]).transform((v) => String(v)),
    to: z.string().email(),
    subjectText: z.string().min(1).max(300),
    html: z.string().min(1),
    seq: z.number().int().positive().optional(),
    fromName: z.string().max(120).optional(),
    replyTo: z.string().email().optional(),
});

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
    if (!session || !['admin', 'rop'].includes(session.user.role)) {
        return NextResponse.json({ error: 'forbidden' }, { status: 403 });
    }

    let body: z.infer<typeof BodySchema>;
    try {
        body = BodySchema.parse(await req.json());
    } catch (e: any) {
        return NextResponse.json({ error: 'invalid_body', details: e?.errors ?? String(e) }, { status: 400 });
    }

    const seq = body.seq ?? (await nextThreadSeq(body.orderNumber));

    const result = await sendOrderEmail({
        to: body.to,
        orderNumber: body.orderNumber,
        subjectText: body.subjectText,
        html: body.html,
        seq,
        fromName: body.fromName,
        replyTo: body.replyTo,
    });

    if (!result.sent) {
        return NextResponse.json({ ok: false, ...result }, { status: 502 });
    }
    // Отправлено, но если копия не легла в Sent — отдаём 200 с предупреждением (письмо ушло клиенту).
    return NextResponse.json({ ok: true, ...result });
}
