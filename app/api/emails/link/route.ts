/**
 * Привязать письмо к заказу руками — экран «Разбор».
 *
 * Если автоматика не нашла заказ (клиент снёс тему, написал с другого адреса,
 * переслал через коллегу), письмо висит в разборе. Человек говорит, чей это
 * заказ, и письмо встаёт в его переписку — молча терять такие письма нельзя
 * (ТЗ §3, пункт 5).
 */
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getSession } from '@/lib/auth';
import { supabase } from '@/utils/supabase';
import { resolveOrderRef } from '@/lib/own-crm/order-ref';

export const dynamic = 'force-dynamic';

const BodySchema = z.object({
    emailId: z.string().min(1).max(64),
    orderNumber: z.string().trim().min(1).max(32),
});

export async function POST(req: Request) {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: 'Неавторизован' }, { status: 401 });

    const parsed = BodySchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
        return NextResponse.json({ error: 'Укажите письмо и номер заказа' }, { status: 400 });
    }

    const ref = await resolveOrderRef(parsed.data.orderNumber);
    if (!ref) {
        return NextResponse.json(
            { error: `Заказа №${parsed.data.orderNumber} у нас нет — проверьте номер` },
            { status: 404 },
        );
    }

    const { data: letter } = await supabase
        .from('incoming_emails')
        .select('id, created_crm_order_number')
        .eq('id', parsed.data.emailId)
        .maybeSingle();

    if (!letter) return NextResponse.json({ error: 'Письмо не найдено' }, { status: 404 });

    if ((letter as any).created_crm_order_number) {
        return NextResponse.json(
            { error: `Письмо уже привязано к заказу №${(letter as any).created_crm_order_number}` },
            { status: 409 },
        );
    }

    const who = session.user.email || session.user.username || session.user.role;
    const { error } = await supabase
        .from('incoming_emails')
        .update({
            created_crm_order_number: ref.number,
            created_crm_order_id: ref.orderId,
            linked_order_id: ref.orderId,
            // Видно, что заказ проставил человек, а не разбор.
            reasoning: `Привязано вручную (${who})`,
            updated_at: new Date().toISOString(),
        })
        .eq('id', parsed.data.emailId);

    if (error) return NextResponse.json({ error: `Не удалось привязать: ${error.message}` }, { status: 500 });

    return NextResponse.json({
        ok: true,
        orderNumber: ref.number,
        message: `Письмо встало в переписку заказа №${ref.number}.`,
    });
}
