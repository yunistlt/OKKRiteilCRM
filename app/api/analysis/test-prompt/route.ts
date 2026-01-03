import { NextResponse } from 'next/server';
import { analyzeOrderWithAI } from '@/lib/prioritization';
import { supabase } from '@/utils/supabase';
import { resolveRetailCRMLabel } from '@/lib/retailcrm-mapping';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
    const body = await req.json();
    const { prompt, orderId } = body;

    if (!prompt) {
        return NextResponse.json({ error: 'Prompt required' }, { status: 400 });
    }

    // Fetch order data with all related info
    let query = supabase
        .from('orders')
        .select(`
            id, number, status, created_at, updated_at, totalsumm, manager_id, raw_payload,
            call_order_matches (
                raw_telphin_calls (
                  *
                )
            )
        `);

    if (orderId) {
        query = query.eq('id', orderId);
    } else {
        // Get first working order with transcript
        const { data: workingStatuses } = await supabase
            .from('status_settings')
            .select('code')
            .eq('is_working', true);
        const workingCodes = (workingStatuses || []).map(s => s.code);
        if (workingCodes.length > 0) {
            query = query.in('status', workingCodes);
        }
        query = query.limit(10); // Get 10 and pick one with transcript
    }

    const { data: orders, error } = await query;

    if (!orders || orders.length === 0) {
        return NextResponse.json({ error: 'Order not found' }, { status: 404 });
    }

    // Pick first order with transcript, or just first
    const order = orders.find((o: any) => {
        const calls = (o.call_order_matches || []).flatMap((m: any) => m.raw_telphin_calls ? [m.raw_telphin_calls] : []);
        return calls.some((c: any) => c?.transcript);
    }) || orders[0];

    // Flatten calls and sort by timestamp
    // Flatten calls and sort by timestamp
    const allCalls = (order.call_order_matches || [])
        .flatMap((m: any) => m.raw_telphin_calls ? [m.raw_telphin_calls] : [])
        .filter((c: any) => c !== null)
        .sort((a: any, b: any) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

    const lastCall = allCalls[0];
    const transcript = lastCall?.transcript || "Нет транскрипта";

    // Get manager info
    const { data: manager } = await supabase
        .from('managers')
        .select('id, first_name, last_name')
        .eq('id', order.manager_id)
        .single();

    const managerName = manager
        ? `${manager.first_name || ''} ${manager.last_name || ''}`.trim()
        : 'Не назначен';

    // Get human-readable status name from statuses table
    const { data: statusSetting } = await supabase
        .from('statuses')
        .select('name, code')
        .eq('code', order.status)
        .single();

    const statusName = statusSetting?.name || order.status; // Fallback to code if not found

    // Extract custom fields from raw_payload
    const payload = order.raw_payload as any || {};
    const customFields = payload.customFields || {};

    const productCategory = await resolveRetailCRMLabel('productCategory', customFields.typ_castomer);
    const clientCategory = await resolveRetailCRMLabel('clientCategory', customFields.sfera_deiatelnosti || customFields.kategoria_klienta_po_vidu);
    const orderMethod = await resolveRetailCRMLabel('orderMethod', payload.orderMethod);
    const orderComments = payload.managerComment || payload.customerComment || 'Нет комментариев';

    const top3 = {
        price: await resolveRetailCRMLabel('top3Price', customFields.top3_prokhodim_li_po_tsene2),
        timing: await resolveRetailCRMLabel('top3Timing', customFields.top3_prokhodim_po_srokam1),
        specs: await resolveRetailCRMLabel('top3Specs', customFields.top3_prokhodim_po_tekh_kharakteristikam)
    };

    const daysSinceUpdate = (new Date().getTime() - new Date(order.updated_at).getTime()) / (1000 * 3600 * 24);

    try {
        const result = await analyzeOrderWithAI(
            transcript,
            order.status,
            daysSinceUpdate,
            order.totalsumm || 0,
            prompt,
            top3
        );

        return NextResponse.json({
            result,
            order: {
                number: order.number,
                id: order.id,
                status: statusName, // Human-readable name
                statusCode: order.status, // Keep code for reference
                managerName,
                managerId: order.manager_id,
                totalSum: order.totalsumm || 0,
                createdAt: order.created_at,
                updatedAt: order.updated_at,
                daysSinceUpdate: Math.round(daysSinceUpdate),
                lastCall: lastCall ? {
                    timestamp: lastCall.timestamp,
                    duration: lastCall.duration,
                    transcript: transcript.substring(0, 500), // First 500 chars for display
                    transcriptFull: transcript
                } : null,
                comments: orderComments,
                productCategory,
                clientCategory,
                totalCalls: allCalls.length
            }
        });
    } catch (e: any) {
        // Return order data even if AI analysis fails
        return NextResponse.json({
            error: e.message,
            order: {
                number: order.number,
                id: order.id,
                status: statusName, // Human-readable name
                statusCode: order.status, // Keep code for reference
                managerName,
                managerId: order.manager_id,
                totalSum: order.totalsumm || 0,
                createdAt: order.created_at,
                updatedAt: order.updated_at,
                daysSinceUpdate: Math.round(daysSinceUpdate),
                lastCall: lastCall ? {
                    timestamp: lastCall.timestamp,
                    duration: lastCall.duration,
                    transcript: transcript.substring(0, 500),
                    transcriptFull: transcript
                } : null,
                comments: orderComments,
                productCategory,
                clientCategory,
                totalCalls: allCalls.length
            }
        }, { status: 500 });
    }
}
