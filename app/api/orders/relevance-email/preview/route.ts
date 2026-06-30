import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getSession } from '@/lib/auth';
import { getCandidateByOrderId, generateRelevanceEmail } from '@/lib/order-relevance-email';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * Генерирует черновик письма об актуальности по конкретному заказу (для предпросмотра
 * перед отправкой). Состав — из данных заказа, проза/триггеры — LLM. Доступ: admin/rop.
 */
const BodySchema = z.object({ orderId: z.number().int().positive() });

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

    const candidate = await getCandidateByOrderId(body.orderId);
    if (!candidate) {
        return NextResponse.json({ error: 'order_not_found' }, { status: 404 });
    }

    const draft = await generateRelevanceEmail(candidate);

    return NextResponse.json({
        ok: true,
        orderId: candidate.orderId,
        number: candidate.number,
        toEmail: candidate.toEmail,
        contactName: candidate.contactName,
        customerName: candidate.customerName,
        total: candidate.total,
        subjectText: draft.subjectText,
        html: draft.html,
        aiUsed: draft.aiUsed,
    });
}
