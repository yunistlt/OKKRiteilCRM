
import { NextResponse } from 'next/server';
import { analyzeOrderWithAI } from '@/lib/prioritization';
import { supabase } from '@/utils/supabase';
import { resolveRetailCRMLabel } from '@/lib/retailcrm-mapping';

export const dynamic = 'force-dynamic';

export async function POST(
    req: Request,
    { params }: { params: { id: string } }
) {
    const orderId = params.id;

    if (!orderId) {
        return NextResponse.json({ error: 'Order ID is required' }, { status: 400 });
    }

    try {
        // 1. Fetch full order context
        const { data: order, error } = await supabase
            .from('orders')
            .select(`
                *,
                call_order_matches (
                    raw_telphin_calls (*)
                )
            `)
            .eq('id', orderId)
            .single();

        if (error || !order) {
            return NextResponse.json({ error: 'Order not found' }, { status: 404 });
        }

        // 2. Prepare data for AI
        // Flatten calls and sort by timestamp
        const allCalls = (order.call_order_matches || [])
            .flatMap((m: any) => m.raw_telphin_calls ? [m.raw_telphin_calls] : [])
            .filter((c: any) => c !== null)
            .sort((a: any, b: any) => new Date(b.started_at).getTime() - new Date(a.started_at).getTime());

        const lastCall = allCalls[0];
        const transcript = lastCall?.transcript || "Нет транскрипта";

        const daysSinceUpdate = (new Date().getTime() - new Date(order.updated_at).getTime()) / (1000 * 3600 * 24);

        // Extract custom fields from raw_payload
        const payload = order.raw_payload as any || {};
        const customFields = payload.customFields || {};
        const orderComments = payload.managerComment || payload.customerComment || 'Нет комментариев';

        // Prepare Top 3
        const top3 = {
            price: await resolveRetailCRMLabel('top3Price', customFields.top3_prokhodim_li_po_tsene2),
            timing: await resolveRetailCRMLabel('top3Timing', customFields.top3_prokhodim_po_srokam1),
            specs: await resolveRetailCRMLabel('top3Specs', customFields.top3_prokhodim_po_tekh_kharakteristikam)
        };

        // Prepare context
        const items = (payload.items || []) as any[];
        const productInfo = items.map(i => `${i.offer?.name || i.name} (x${i.quantity})`).join(', ') || "Нет товаров";

        // Get human-readable status name (optional, but good for context)
        const { data: statusSetting } = await supabase
            .from('statuses')
            .select('name')
            .eq('code', order.status)
            .single();
        const statusName = statusSetting?.name || order.status;

        const extraContext = {
            productInfo,
            commentsContext: orderComments,
            statusHistoryStr: `Current Status: ${statusName} (${order.status})`, // Ideally fetch history, but this is okay for now
            callPattern: `Total calls: ${allCalls.length}. Last duration: ${lastCall?.duration_sec || 0}s`
        };

        // 3. Run Analysis
        const result = await analyzeOrderWithAI(
            transcript,
            order.status,
            daysSinceUpdate,
            order.totalsumm || 0,
            extraContext,
            undefined, // Use default prompt
            top3
        );

        // 4. Upsert Priority
        const { error: upsertError } = await supabase
            .from('order_priorities')
            .upsert({
                order_id: order.id,
                level: result.traffic_light,
                score: result.traffic_light === 'red' ? 90 : result.traffic_light === 'yellow' ? 50 : 10,
                reasons: {
                    user_reasoning: result.short_reason, // Map short_reason to reasons structure or keep separate? 
                    // Let's store the whole result object or map fields correctly based on schema.
                    // Checking schema... typically 'reasons' is jsonb.
                    analysis_steps: result.analysis_steps
                },
                summary: result.short_reason,
                recommended_action: result.recommended_action,
                updated_at: new Date().toISOString()
            }, { onConflict: 'order_id' });

        if (upsertError) {
            console.error('Upsert priority error:', upsertError);
            throw new Error('Failed to save priority');
        }

        // 5. Return result
        return NextResponse.json({ success: true, result });

    } catch (e: any) {
        console.error('Analysis error:', e);
        return NextResponse.json({ error: e.message || 'Analysis failed' }, { status: 500 });
    }
}
