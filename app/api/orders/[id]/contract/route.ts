import { NextResponse } from 'next/server';
import { z } from 'zod';
import { standardTerm } from '@/lib/legal/contract-terms';
import { getSession } from '@/lib/auth';
import { supabase } from '@/utils/supabase';
import { createOrderContract, CONTRACT_STATUS_LABELS } from '@/lib/legal/order-contract';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

/** Договоры по заказу: список для карточки. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: 'Неавторизован' }, { status: 401 });

    const { id } = await params;
    const orderNumber = decodeURIComponent(String(id));

    const { data, error } = await supabase
        .from('order_contracts')
        .select('id, title, status, version, terms_text, created_by, reviewed_by, review_comment, created_at, updated_at')
        .eq('order_number', orderNumber)
        .is('deleted_at', null)
        .order('created_at', { ascending: false });

    if (error) {
        console.error('[contract] список не прочитался:', error);
        return NextResponse.json({ error: 'Не удалось прочитать договоры по заказу' }, { status: 500 });
    }

    return NextResponse.json({
        contracts: (data || []).map((row: any) => ({
            ...row,
            statusLabel: CONTRACT_STATUS_LABELS[row.status] || row.status,
        })),
    });
}

const CreateSchema = z.object({
    /** Условия словами: «70 предоплата, 30 перед отгрузкой». */
    terms: z.string().trim().min(1, 'Напишите условия договора'),
    /**
     * Код стандартных условий из списка. Такой договор составляется сразу, без
     * юриста: это согласованная редакция (решение владельца 07.10.2026).
     */
    termCode: z.string().trim().optional().nullable(),
    /** Юрлицо-продавец, если менеджер выбрал его в карточке. */
    seller: z.string().trim().optional().nullable(),
    orderId: z.number().int().positive(),
});

/** Составить договор и отправить юристу на согласование. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: 'Неавторизован' }, { status: 401 });

    const { id } = await params;
    const orderNumber = decodeURIComponent(String(id));

    const parsed = CreateSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
        return NextResponse.json({ error: parsed.error.issues[0]?.message || 'Проверьте условия' }, { status: 400 });
    }

    // Выбран пункт из списка — условия берём из справочника, не из текста.
    const standard = standardTerm(parsed.data.termCode);

    const result = await createOrderContract({
        orderId: parsed.data.orderId,
        orderNumber,
        termsText: standard ? standard.text : parsed.data.terms,
        sellerCode: parsed.data.seller ?? null,
        author: session.user.email || session.user.role,
        toLawyer: standard ? false : true,
        // Стандартный текст согласован — ИИ его не переписывает.
        termsAsIs: Boolean(standard),
    });

    if (!result.ok) {
        return NextResponse.json({ error: result.reason }, { status: 400 });
    }

    return NextResponse.json({
        ok: true,
        id: result.id,
        // Замечания ИИ-юрисконсульта показываем сразу, в том же окне.
        review: result.review,
        note: standard
            ? 'Договор составлен по стандартным условиям — можно отправлять клиенту.'
            : result.byAi
                ? 'Договор составлен и отправлен юристу на согласование. Условия оплаты сформулировал ИИ — юрист проверит.'
                : 'Договор составлен и отправлен юристу на согласование.',
    });
}
