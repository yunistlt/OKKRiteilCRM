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
import { sameCompany } from '@/lib/own-crm/same-company';

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

    /**
     * Телефон, ИНН и контактное лицо в карточках клиентов почти не заполнены:
     * они приезжают в заказах, а не в справочнике покупателей. Берём их из
     * последнего заказа клиента — колонки «ИНН» и «Контакт» в списке стояли
     * пустыми у всех (замечание владельца 05.10.2026).
     *
     * Один запрос на страницу, не по клиенту.
     */
    const ids = rows.map((r) => String(r.id)).filter(Boolean);
    const phones = new Map<string, string>();
    const inns = new Map<string, string>();
    const contacts = new Map<string, string>();

    if (ids.length) {
        const { data: fromOrders } = await supabase
            .from('orders')
            .select('"customer", phone, "contragent", "firstName", "lastName", "createdAt"')
            .filter('customer->>id', 'in', `(${ids.join(',')})`)
            .order('createdAt', { ascending: false });

        for (const row of (fromOrders || []) as any[]) {
            const key = String(row.customer?.id ?? '');
            if (!key) continue;

            if (!phones.has(key) && row.phone) phones.set(key, String(row.phone));

            /**
             * ИНН берём из заказа, только если контрагент в нём — тот же, что
             * клиент. В заказе бывает совсем другое юрлицо, и чужой ИНН в
             * карточке клиента опаснее пустой клетки.
             */
            const client = rows.find((r) => String(r.id) === key);
            if (!inns.has(key)
                && row.contragent?.INN
                && sameCompany(row.contragent?.legalName, (client as any)?.company_name)) {
                inns.set(key, String(row.contragent.INN));
            }

            const contact = [row.lastName, row.firstName].filter(Boolean).join(' ').trim();
            if (!contacts.has(key) && contact) contacts.set(key, contact);
        }
    }

    rows = rows.map((row) => {
        const key = String(row.id);
        return {
            ...row,
            phone_from_order: phones.get(key) || null,
            // Своё значение главнее: его вписал человек.
            inn: row.inn || inns.get(key) || null,
            contact_name: row.contact_name || contacts.get(key) || null,
        };
    });

    return NextResponse.json({
        clients: rows,
        total: count ?? rows.length,
        page,
        pageSize,
    });
}
