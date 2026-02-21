import { NextResponse } from 'next/server';
import { evaluateOrder } from '@/lib/okk-evaluator';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

// POST /api/okk/evaluate/:orderId — событийный триггер
export async function POST(
    request: Request,
    { params }: { params: { orderId: string } }
) {
    const orderId = parseInt(params.orderId);
    if (!orderId || isNaN(orderId)) {
        return NextResponse.json({ error: 'Invalid orderId' }, { status: 400 });
    }

    try {
        await evaluateOrder(orderId);
        return NextResponse.json({ success: true, order_id: orderId });
    } catch (e: any) {
        console.error('[ОКК API] Evaluate error:', e);
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}
