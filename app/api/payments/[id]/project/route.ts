import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getSession } from '@/lib/auth';
import { setPointPaymentProject } from '@/lib/payments/service';

export const dynamic = 'force-dynamic';

const BodySchema = z.object({ project: z.enum(['zmktl', 'stolyarka', 'consulting']) });

// POST /api/payments/[id]/project — ручной выбор проекта платежа.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await getSession(req);
    if (!session?.user) return NextResponse.json({ error: 'Неавторизован' }, { status: 401 });

    const paymentId = Number(params.id);
    if (!Number.isFinite(paymentId)) {
      return NextResponse.json({ error: 'Некорректный id' }, { status: 400 });
    }

    const parsed = BodySchema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) return NextResponse.json({ error: 'Укажите проект' }, { status: 400 });

    await setPointPaymentProject({
      paymentId,
      project: parsed.data.project,
      reviewedBy: session.user.email || session.user.id || 'operator',
    });
    return NextResponse.json({ success: true });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
