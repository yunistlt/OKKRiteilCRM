/**
 * Сводка по сделке для того, кто сейчас разговаривает.
 *
 * Просьба владельца 05.10.2026: когда менеджер говорит и заказ определён,
 * показывать краткое саммари. Берём заказ у идущего звонка, а если звонок уже
 * кончился — у его привязки.
 */
import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { supabase } from '@/utils/supabase';
import { callSummary } from '@/lib/calls/call-summary';
import { existingBinding } from '@/lib/call-binding';

export const dynamic = 'force-dynamic';

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: 'Неавторизован' }, { status: 401 });

    const { id } = await params;
    const callId = decodeURIComponent(id);

    const { data: active } = await supabase
        .from('active_calls')
        .select('order_id')
        .ilike('telphin_call_id', callId)
        .maybeSingle();

    let orderId = (active as any)?.order_id ?? null;
    if (!orderId) {
        const bound = await existingBinding(callId);
        orderId = bound?.orderId ?? null;
    }

    if (!orderId) return NextResponse.json({ summary: null });

    const summary = await callSummary(Number(orderId));
    return NextResponse.json({ summary });
}
