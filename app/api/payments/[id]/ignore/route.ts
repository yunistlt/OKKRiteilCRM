import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getSession } from '@/lib/auth';
import { ignorePointPayment } from '@/lib/payments/service';

export const dynamic = 'force-dynamic';

const BodySchema = z.object({ note: z.string().optional() });

// POST /api/payments/[id]/ignore — пометить платёж как не наш / возврат.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await getSession(req);
    if (!session?.user) return NextResponse.json({ error: 'Неавторизован' }, { status: 401 });

    const paymentId = Number(params.id);
    if (!Number.isFinite(paymentId)) {
      return NextResponse.json({ error: 'Некорректный id' }, { status: 400 });
    }

    const parsed = BodySchema.safeParse(await req.json().catch(() => ({})));
    await ignorePointPayment({
      paymentId,
      reviewedBy: session.user.email || session.user.id || 'operator',
      note: parsed.success ? parsed.data.note ?? null : null,
    });

    return NextResponse.json({ success: true });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
