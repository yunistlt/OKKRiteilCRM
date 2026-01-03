import { NextResponse } from 'next/server';
import { supabase } from '@/utils/supabase';

import { resolveRetailCRMLabel } from '@/lib/retailcrm-mapping';

export const dynamic = 'force-dynamic';

// GET - Fetch a random order from working statuses for manual evaluation
export async function GET() {
    // Get working statuses
    const { data: workingStatuses } = await supabase
        .from('status_settings')
        .select('code')
        .eq('is_working', true);

    const workingCodes = (workingStatuses || []).map(s => s.code);

    if (workingCodes.length === 0) {
        return NextResponse.json({ error: 'No working statuses configured' }, { status: 404 });
    }

    // Get already evaluated order IDs
    const { data: trainingExamples } = await supabase
        .from('training_examples')
        .select('order_id');

    const evaluatedOrderIds = (trainingExamples || []).map(ex => ex.order_id);

    // Count total orders to calculate random offset
    const { count } = await supabase
        .from('orders')
        .select('*', { count: 'exact', head: true })
        .in('status', workingCodes);

    const totalOrders = count || 0;
    if (totalOrders === 0) {
        return NextResponse.json({ error: 'No orders found' }, { status: 404 });
    }

    // Random offset to get different orders each time
    const randomOffset = Math.floor(Math.random() * Math.max(0, totalOrders - 50));

    // Fetch random orders with transcripts
    let query = supabase
        .from('orders')
        .select(`
            id, number, status, created_at, updated_at, totalsumm, manager_id, raw_payload,
            call_order_matches (
                raw_telphin_calls (
                  *
                )
            )
        `)
        .in('status', workingCodes)
        .range(randomOffset, randomOffset + 49); // Get 50 orders from random offset

    // Exclude already evaluated orders if there are any
    if (evaluatedOrderIds.length > 0) {
        query = query.not('id', 'in', `(${evaluatedOrderIds.join(',')})`);
    }

    const { data: orders, error } = await query;

    if (!orders || orders.length === 0 || error) {
        return NextResponse.json({ error: 'No orders found' }, { status: 404 });
    }

    // Shuffle orders and find one with transcript
    const shuffled = orders.sort(() => Math.random() - 0.5);
    const orderWithTranscript = shuffled.find((o: any) => {
        // Map matches -> calls
        const calls = (o.call_order_matches || []).flatMap((m: any) => m.raw_telphin_calls ? [m.raw_telphin_calls] : []);
        return calls.some((c: any) => c?.transcript);
    });

    const order = orderWithTranscript || shuffled[0];

    // Flatten calls and sort by timestamp
    // Flatten calls and sort by timestamp
    const allCalls = (order.call_order_matches || [])
        .flatMap((m: any) => m.raw_telphin_calls ? [m.raw_telphin_calls] : [])
        .filter((c: any) => c !== null)
        .sort((a: any, b: any) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

    const lastCall = allCalls[0];

    // Get manager info
    const { data: manager } = await supabase
        .from('managers')
        .select('id, first_name, last_name')
        .eq('id', order.manager_id)
        .single();

    const managerName = manager
        ? `${manager.first_name || ''} ${manager.last_name || ''}`.trim()
        : 'Не назначен';

    // Get human-readable status name
    const { data: statusSetting } = await supabase
        .from('statuses')
        .select('name, code')
        .eq('code', order.status)
        .single();

    const statusName = statusSetting?.name || order.status;

    // Extract custom fields mapping
    const payload = order.raw_payload as any || {};
    const customFields = payload.customFields || {};

    // Correct mapping for this specific RetailCRM setup
    const productCategory = await resolveRetailCRMLabel('productCategory', customFields.typ_castomer);
    const clientCategory = await resolveRetailCRMLabel('clientCategory', customFields.sfera_deiatelnosti || customFields.kategoria_klienta_po_vidu);

    // Add more context fields
    const managerComment = payload.managerComment || '';
    const customerComment = payload.customerComment || '';
    const orderMethod = await resolveRetailCRMLabel('orderMethod', payload.orderMethod);

    // Extract next contact date
    const nextContactDate = customFields.data_kontakta || null;

    // Quality Control TOP-3
    const top3 = {
        price: await resolveRetailCRMLabel('top3Price', customFields.top3_prokhodim_li_po_tsene2),
        timing: await resolveRetailCRMLabel('top3Timing', customFields.top3_prokhodim_po_srokam1),
        specs: await resolveRetailCRMLabel('top3Specs', customFields.top3_prokhodim_po_tekh_kharakteristikam)
    };

    // Calculate days since last interaction (calls, status updates, or general updates)
    const possibleDates = [
        new Date(order.created_at).getTime()
    ];

    if (order.updated_at) possibleDates.push(new Date(order.updated_at).getTime());
    if (payload.statusUpdatedAt) possibleDates.push(new Date(payload.statusUpdatedAt).getTime());
    if (lastCall?.timestamp) possibleDates.push(new Date(lastCall.timestamp).getTime());

    // Take the most recent date
    const lastInteractionTimestamp = Math.max(...possibleDates);
    const daysSinceUpdate = (new Date().getTime() - lastInteractionTimestamp) / (1000 * 3600 * 24);

    return NextResponse.json({
        id: order.id,
        number: order.number,
        status: statusName,
        statusCode: order.status,
        managerName,
        managerId: order.manager_id,
        totalSum: order.totalsumm || 0,
        createdAt: order.created_at,
        updatedAt: order.updated_at,
        daysSinceUpdate: Math.round(daysSinceUpdate),
        lastCall: lastCall ? {
            timestamp: lastCall.timestamp,
            duration: lastCall.duration,
            transcript: lastCall.transcript || 'Нет транскрипта',
            transcriptPreview: (lastCall.transcript || 'Нет транскрипта').substring(0, 500)
        } : null,
        comments: {
            manager: managerComment,
            customer: customerComment
        },
        orderMethod,
        productCategory,
        clientCategory,
        top3,
        totalCalls: allCalls.length,
        nextContactDate: nextContactDate || null
    });
}
