/**
 * Заказ звонка: подсказать варианты и записать выбор менеджера.
 *
 * Решение владельца 05.10.2026: входящий звонок тоже должен знать свой заказ, а
 * угадывать мы перестали. Автомат привязывает только очевидное — клиент опознан
 * и у него ровно один открытый заказ; во всех остальных случаях заказ называет
 * человек, и делает это отсюда.
 *
 * GET  — кто звонит, к чему звонок уже привязан и из чего выбирать.
 * POST — записать выбранный заказ (способ `manual`).
 */
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getSession } from '@/lib/auth';
import { supabase } from '@/utils/supabase';
import { bindCallToOrder, clientPhoneOfCall, existingBinding, ordersByPhone } from '@/lib/call-binding';

export const dynamic = 'force-dynamic';

const BodySchema = z.object({
    orderId: z.coerce.number().int().positive(),
});

async function loadCall(id: string) {
    const { data } = await supabase
        .from('raw_telphin_calls')
        .select('telphin_call_id, direction, from_number, to_number, from_number_normalized, to_number_normalized, started_at')
        .ilike('telphin_call_id', decodeURIComponent(id))
        .limit(1);
    return ((data ?? []) as any[])[0] ?? null;
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: 'Неавторизован' }, { status: 401 });

    const { id } = await params;
    const call = await loadCall(id);
    if (!call) return NextResponse.json({ error: 'Звонок не найден' }, { status: 404 });

    const phone = clientPhoneOfCall(call);
    const [bound, candidates] = await Promise.all([
        existingBinding(call.telphin_call_id),
        phone ? ordersByPhone(phone, 20) : Promise.resolve([]),
    ]);

    // Названия статусов — человеку, а не коды.
    const codes = Array.from(new Set(candidates.map((c) => c.status).filter(Boolean) as string[]));
    const names = new Map<string, string>();
    if (codes.length) {
        const { data } = await supabase.from('crm_statuses').select('external_code, name').in('external_code', codes);
        for (const row of ((data ?? []) as any[])) names.set(String(row.external_code), String(row.name));
    }

    return NextResponse.json({
        callId: call.telphin_call_id,
        phone: call.from_number,
        direction: call.direction,
        startedAt: call.started_at,
        boundOrderId: bound?.orderId ?? null,
        boundMethod: bound?.method ?? null,
        orders: candidates.map((c) => ({
            orderId: c.orderId,
            number: c.number,
            status: c.status ? (names.get(c.status) ?? c.status) : null,
            createdAt: c.createdAt,
        })),
    });
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: 'Неавторизован' }, { status: 401 });

    const { id } = await params;

    let body: z.infer<typeof BodySchema>;
    try {
        body = BodySchema.parse(await req.json());
    } catch (e: any) {
        return NextResponse.json({ error: 'Не передан номер заказа', details: e?.errors ?? String(e) }, { status: 400 });
    }

    const call = await loadCall(id);
    if (!call) return NextResponse.json({ error: 'Звонок не найден' }, { status: 404 });

    const { data: order } = await supabase
        .from('orders')
        .select('id, number')
        .eq('id', body.orderId)
        .maybeSingle();
    if (!order) return NextResponse.json({ error: 'Такого заказа нет' }, { status: 404 });

    const who = [session.user.first_name, session.user.last_name].filter(Boolean).join(' ')
        || session.user.email
        || session.user.role;

    await bindCallToOrder({
        callId: call.telphin_call_id,
        orderId: Number((order as any).id),
        method: 'manual',
        reason: 'Заказ указан менеджером',
        by: who,
    });

    return NextResponse.json({ ok: true, orderId: Number((order as any).id), orderNumber: (order as any).number });
}
