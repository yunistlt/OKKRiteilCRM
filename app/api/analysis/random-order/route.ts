// @ts-nocheck
import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { hasAnyRole } from '@/lib/rbac';
import { supabase } from '@/utils/supabase';

/**
 * Звонки по заказам — через общую связь call_order_link.
 *
 * Привязку знает RetailCRM; наш матчинг по номеру телефона запасной и
 * ошибается примерно в трети случаев.
 */
async function loadCallsByOrder(orderIds: number[]): Promise<Map<number, any[]>> {
    const byOrder = new Map<number, any[]>();
    if (orderIds.length === 0) return byOrder;

    const { data: links } = await supabase
        .from('call_order_link')
        .select('order_id, telphin_call_id')
        .in('order_id', orderIds);
    const rows = (links ?? []) as any[];
    if (rows.length === 0) return byOrder;

    const ids = Array.from(new Set(rows.map((l) => String(l.telphin_call_id))));
    const rawById = new Map<string, any>();
    for (let i = 0; i < ids.length; i += 300) {
        const { data: raw } = await supabase
            .from('raw_telphin_calls')
            .select('*')
            .in('telphin_call_id', ids.slice(i, i + 300));
        for (const c of ((raw ?? []) as any[])) rawById.set(String(c.telphin_call_id), c);
    }

    for (const l of rows) {
        const call = rawById.get(String(l.telphin_call_id));
        if (!call) continue;
        const list = byOrder.get(Number(l.order_id)) ?? [];
        list.push(call);
        byOrder.set(Number(l.order_id), list);
    }
    return byOrder;
}

import { resolveRetailCRMLabel } from '@/lib/retailcrm/mapping';

export const dynamic = 'force-dynamic';

// GET - Fetch a random order from working statuses for manual evaluation
export async function GET() {
    const session = await getSession();
    if (!hasAnyRole(session, ['admin'])) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

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
            id, number, status, created_at, updated_at, totalsumm, manager_id, raw_payload
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

    const callsByOrder = await loadCallsByOrder((orders as any[]).map((o) => Number(o.id)));

    // Shuffle orders and find one with transcript
    const shuffled = orders.sort(() => Math.random() - 0.5);
    const orderWithTranscript = shuffled.find((o: any) => {
        // Map matches -> calls
        const calls = callsByOrder.get(Number(o.id)) ?? [];
        return calls.some((c: any) => c?.transcript);
    });

    const order = orderWithTranscript || shuffled[0];

    const allCalls = (callsByOrder.get(Number(order.id)) ?? [])
        .filter((c: any) => c !== null)
        // У звонков Телфина время в started_at; timestamp остаётся запасным
        // именем для старых записей.
        .sort(
            (a: any, b: any) =>
                new Date(b.started_at ?? b.timestamp).getTime() - new Date(a.started_at ?? a.timestamp).getTime(),
        );

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
