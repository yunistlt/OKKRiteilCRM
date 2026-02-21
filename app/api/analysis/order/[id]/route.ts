
import { NextResponse } from 'next/server';
import { runInsightAnalysis } from '@/lib/insight-agent';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(
    request: Request,
    { params }: { params: { id: string } }
) {
    const orderId = parseInt(params.id);

    if (isNaN(orderId)) {
        return NextResponse.json({ error: 'Invalid order ID' }, { status: 400 });
    }

    try {
        console.log(`[Manual Analysis] Running for order ${orderId}...`);

        const insights = await runInsightAnalysis(orderId);

        if (!insights) {
            return NextResponse.json({
                success: false,
                message: 'Order not found or analysis failed'
            }, { status: 404 });
        }

        return NextResponse.json({
            success: true,
            orderId: orderId,
            insights: insights,
            timestamp: new Date().toISOString()
        });

    } catch (error: any) {
        console.error('[Manual Analysis] Trigger Failed:', error);
        return NextResponse.json({
            success: false,
            error: error.message
        }, { status: 500 });
    }
}
