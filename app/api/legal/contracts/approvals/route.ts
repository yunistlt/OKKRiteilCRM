import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getSession } from '@/lib/auth';
import { supabase } from '@/utils/supabase';
import { CONTRACT_STATUS_LABELS, decideOrderContract, reviseOrderContract } from '@/lib/legal/order-contract';

export const dynamic = 'force-dynamic';

/** Документы на согласовании — рабочий список юриста. */
export async function GET(req: Request) {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: 'Неавторизован' }, { status: 401 });

    const { searchParams } = new URL(req.url);
    // По умолчанию показываем то, что ждёт юриста; остальное — по выбору.
    const status = searchParams.get('status') || 'on_review';

    let query = supabase
        .from('order_contracts')
        .select('id, order_number, title, status, version, terms_text, body_text, created_by, created_at, updated_at, reviewed_by, reviewed_at, review_comment')
        .is('deleted_at', null)
        .order('created_at', { ascending: false })
        .limit(200);

    if (status !== 'all') query = query.eq('status', status);

    const { data, error } = await query;
    if (error) {
        console.error('[legal-approvals] список не прочитался:', error);
        return NextResponse.json({ error: 'Не удалось прочитать список документов' }, { status: 500 });
    }

    return NextResponse.json({
        contracts: (data || []).map((row: any) => ({
            ...row,
            statusLabel: CONTRACT_STATUS_LABELS[row.status] || row.status,
        })),
        statuses: Object.entries(CONTRACT_STATUS_LABELS).map(([code, label]) => ({ code, label })),
    });
}

const DecisionSchema = z.object({
    contractId: z.number().int().positive(),
    action: z.enum(['approve', 'rework', 'revise']),
    comment: z.string().trim().optional().nullable(),
    /** Для правки текста юристом. */
    bodyText: z.string().trim().optional().nullable(),
});

/** Решение юриста: согласовать, вернуть на доработку или поправить текст. */
export async function POST(req: Request) {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: 'Неавторизован' }, { status: 401 });

    const parsed = DecisionSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
        return NextResponse.json({ error: parsed.error.issues[0]?.message || 'Проверьте данные' }, { status: 400 });
    }

    const who = session.user.email || session.user.role;
    const { contractId, action, comment, bodyText } = parsed.data;

    if (action === 'revise') {
        if (!bodyText) return NextResponse.json({ error: 'Текст договора пустой' }, { status: 400 });
        const res = await reviseOrderContract({
            contractId,
            bodyText,
            note: comment || 'Правка юриста',
            author: who,
        });
        if (!res.ok) return NextResponse.json({ error: res.reason }, { status: 500 });
        return NextResponse.json({ ok: true, version: res.version, note: `Правка сохранена, версия ${res.version}.` });
    }

    const res = await decideOrderContract({
        contractId,
        decision: action === 'approve' ? 'approved' : 'rework',
        comment,
        reviewer: who,
    });
    if (!res.ok) return NextResponse.json({ error: res.reason }, { status: 500 });

    return NextResponse.json({
        ok: true,
        note: action === 'approve' ? 'Договор согласован.' : 'Договор возвращён менеджеру на доработку.',
    });
}
