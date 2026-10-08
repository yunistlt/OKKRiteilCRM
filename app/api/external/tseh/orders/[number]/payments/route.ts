/**
 * Оплаты по заказу — для ЦехУспеха.
 *
 * Зачем: заказ уезжает в производство один раз, а деньги приходят частями и позже. Поэтому
 * оплаты не кладутся в очередь вместе с заказом, а запрашиваются отдельно: ЦехУспех забирает
 * их при заведении заказа и потом периодически досинхронизирует (решение владельца 06.10.2026,
 * повод — приёмка увидела заказ без оплат и спросила, ставить ли руками).
 *
 * Отдаём только разнесённые платежи этого заказа: идентификатор, дату и сумму. Ни плательщика,
 * ни назначения, ни банковских реквизитов — производству они не нужны.
 */
import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/utils/supabase';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest, { params }: { params: { number: string } }) {
    const key = process.env.TSEH_API_KEY;
    const given = req.headers.get('x-api-key');
    if (!key || !given || given !== key) {
        return NextResponse.json({ error: 'Доступ запрещён' }, { status: 401 });
    }

    const number = decodeURIComponent(params.number);
    const { data, error } = await supabase
        .from('point_payments')
        .select('id, payment_date, payment_datetime, amount_kopecks')
        .eq('matched_order_number', number)
        .order('payment_date', { ascending: true });

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    const payments = (data as any[] | null || []).map((p) => ({
        id: String(p.id),
        // Сумма хранится в копейках — отдаём рублями, чтобы на той стороне не делить ещё раз.
        amount: Number(p.amount_kopecks || 0) / 100,
        date: String(p.payment_date || p.payment_datetime || '').slice(0, 10),
    })).filter((p) => p.amount > 0 && p.date.length === 10);

    return NextResponse.json({ number, payments });
}
