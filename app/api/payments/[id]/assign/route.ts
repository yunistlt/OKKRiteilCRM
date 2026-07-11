import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { supabase } from '@/utils/supabase';
import { getSession } from '@/lib/auth';
import { assignPointPaymentToOrder } from '@/lib/payments/service';

export const dynamic = 'force-dynamic';

const BodySchema = z.object({
  order_number: z.string().min(1),
  note: z.string().optional(),
});

// POST /api/payments/[id]/assign — ручная привязка платежа к заказу и проброс в RetailCRM.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await getSession(req);
    if (!session?.user) return NextResponse.json({ error: 'Неавторизован' }, { status: 401 });

    const paymentId = Number(params.id);
    if (!Number.isFinite(paymentId)) {
      return NextResponse.json({ error: 'Некорректный id' }, { status: 400 });
    }

    const parsed = BodySchema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json({ error: 'Укажите номер заказа' }, { status: 400 });
    }
    const orderNumber = parsed.data.order_number.trim();

    // Резолвим id заказа RetailCRM по номеру (для надёжного проброса платежа).
    const { data: order } = await supabase
      .from('orders')
      .select('order_id, number')
      .eq('number', orderNumber)
      .maybeSingle();

    const result = await assignPointPaymentToOrder({
      paymentId,
      orderId: order?.order_id ?? null,
      orderNumber,
      reviewedBy: session.user.email || session.user.id || 'operator',
      note: parsed.data.note ?? null,
    });

    return NextResponse.json({ success: true, ...result, order_found: Boolean(order) });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
