/**
 * Новый клиент руками.
 *
 * Владелец 05.10.2026: «нет кнопки создать нового клиента». Клиенты приезжали
 * только из RetailCRM и из автоприёма писем; завести покупателя, который
 * позвонил, было нельзя.
 *
 * Идентификаторы своих клиентов идут с отдельного запаса — чтобы не
 * столкнуться с нумерацией RetailCRM.
 */
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getSession } from '@/lib/auth';
import { supabase } from '@/utils/supabase';

export const dynamic = 'force-dynamic';

/** С этого числа начинаются наши клиенты: у RetailCRM номера меньше. */
const OWN_CLIENT_BASE = 900_000_000;

const bodySchema = z.object({
    companyName: z.string().trim().min(2).max(300),
    inn: z.string().trim().max(12).optional().nullable(),
    phone: z.string().trim().max(50).optional().nullable(),
    email: z.string().trim().max(200).optional().nullable(),
    contactName: z.string().trim().max(200).optional().nullable(),
});

export async function POST(request: Request) {
    const session = await getSession();
    if (!session?.user) return NextResponse.json({ error: 'Неавторизован' }, { status: 401 });

    const parsed = bodySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
        return NextResponse.json({ error: 'Впишите хотя бы название клиента' }, { status: 400 });
    }

    const { companyName, inn, phone, email, contactName } = parsed.data;
    const digits = inn ? inn.replace(/\D+/g, '') : '';

    // Тот же клиент уже заведён — не плодим карточки: по ИНН это видно точно.
    if (digits) {
        const { data: same } = await supabase
            .from('clients')
            .select('id, company_name')
            .eq('inn', digits)
            .limit(1)
            .maybeSingle();

        if (same) {
            return NextResponse.json(
                { error: `Клиент с таким ИНН уже есть: ${(same as any).company_name}`, clientId: (same as any).id },
                { status: 409 },
            );
        }
    }

    const { data: last } = await supabase
        .from('clients')
        .select('id')
        .gte('id', OWN_CLIENT_BASE)
        .order('id', { ascending: false })
        .limit(1)
        .maybeSingle();

    const id = Math.max(OWN_CLIENT_BASE, Number((last as any)?.id ?? 0) + 1);

    const { error } = await supabase.from('clients').insert({
        id,
        company_name: companyName,
        legalName: companyName,
        inn: digits || null,
        email: email || null,
        contact_name: contactName || null,
        phones: phone ? [{ number: phone }] : null,
        manager_id: session.user.retail_crm_manager_id ?? null,
    });

    if (error) {
        console.error('[клиенты] не завёлся:', error.message);
        return NextResponse.json({ error: 'Не удалось завести клиента' }, { status: 500 });
    }

    return NextResponse.json({ ok: true, clientId: id });
}
