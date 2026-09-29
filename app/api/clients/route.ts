/**
 * Реестр клиентов: поиск по названию, ИНН, телефону и почте.
 *
 * Клиент здесь — самостоятельная сущность, а не приложение к заказу: цель
 * владельца — 300 постоянных клиентов, и их надо видеть списком, а не
 * вылавливать через заказы.
 */
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { supabase } from '@/utils/supabase';

export const dynamic = 'force-dynamic';

const querySchema = z.object({
    q: z.string().trim().max(200).optional(),
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(20).max(100).default(50),
    sort: z.enum(['total_summ', 'orders_count', 'last_order_at', 'company_name']).default('total_summ'),
});

export async function GET(request: Request) {
    const { searchParams } = new URL(request.url);
    const parsed = querySchema.safeParse(Object.fromEntries(searchParams));
    if (!parsed.success) {
        return NextResponse.json({ error: 'Неверные параметры запроса' }, { status: 400 });
    }

    const { q, page, pageSize, sort } = parsed.data;
    const from = (page - 1) * pageSize;

    let query = supabase
        .from('clients')
        .select('id, company_name, contact_name, inn, phones, email, orders_count, total_summ, average_check, last_order_at, manager_id, "kategoria_klienta", "kategoria_klienta_po_vidu"', { count: 'exact' });

    if (q) {
        const safe = q.replace(/[%,()]/g, ' ').trim();
        const digits = safe.replace(/\D/g, '');
        const parts = [
            `company_name.ilike.%${safe}%`,
            `contact_name.ilike.%${safe}%`,
            `email.ilike.%${safe}%`,
        ];
        if (digits.length >= 4) {
            parts.push(`inn.ilike.%${digits}%`);
        }
        query = query.or(parts.join(','));
    }

    const { data, error, count } = await query
        .order(sort, { ascending: sort === 'company_name', nullsFirst: false })
        .range(from, from + pageSize - 1);

    if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // Телефон ищем отдельно: он хранится массивом, ilike по нему не работает.
    let rows = (data || []) as any[];
    if (q) {
        const digits = q.replace(/\D/g, '');
        if (digits.length >= 6 && rows.length === 0) {
            const { data: byPhone } = await supabase
                .from('clients')
                .select('id, company_name, contact_name, inn, phones, email, orders_count, total_summ, average_check, last_order_at, manager_id')
                .contains('phones', [digits])
                .limit(pageSize);
            rows = (byPhone || []) as any[];
        }
    }

    return NextResponse.json({
        clients: rows,
        total: count ?? rows.length,
        page,
        pageSize,
    });
}
