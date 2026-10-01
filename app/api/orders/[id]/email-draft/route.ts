/**
 * Черновик письма по заказу: сохранить недописанное и вернуться к нему позже.
 * Черновик личный — у каждого менеджера свой по каждому заказу.
 */
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getSession } from '@/lib/auth';
import { supabase } from '@/utils/supabase';

export const dynamic = 'force-dynamic';

const bodySchema = z.object({
    to: z.string().trim().max(300).optional().nullable(),
    subject: z.string().trim().max(500).optional().nullable(),
    body: z.string().max(50000).optional().nullable(),
    attachments: z.array(z.string().max(300)).max(20).optional(),
});

function authorOf(session: any): string {
    return String(session?.user?.username || session?.user?.email || session?.user?.id || 'unknown');
}

export async function GET(_request: Request, { params }: { params: { id: string } }) {
    const session = await getSession();
    if (!session?.user) return NextResponse.json({ error: 'Неавторизован' }, { status: 401 });

    const { data } = await supabase
        .from('order_email_drafts')
        .select('recipient, subject, body, attachments, updated_at')
        .eq('order_number', String(params.id))
        .eq('author', authorOf(session))
        .maybeSingle();

    if (!data) return NextResponse.json({ draft: null });

    return NextResponse.json({
        draft: {
            to: (data as any).recipient ?? '',
            subject: (data as any).subject ?? '',
            body: (data as any).body ?? '',
            attachments: (data as any).attachments ?? [],
            savedAt: (data as any).updated_at,
        },
    });
}

export async function POST(request: Request, { params }: { params: { id: string } }) {
    const session = await getSession();
    if (!session?.user) return NextResponse.json({ error: 'Неавторизован' }, { status: 401 });

    const parsed = bodySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
        return NextResponse.json({ error: 'Черновик не разобрался' }, { status: 400 });
    }

    const { error } = await supabase
        .from('order_email_drafts')
        .upsert(
            {
                order_number: String(params.id),
                author: authorOf(session),
                recipient: parsed.data.to ?? null,
                subject: parsed.data.subject ?? null,
                body: parsed.data.body ?? null,
                attachments: parsed.data.attachments ?? [],
                updated_at: new Date().toISOString(),
            },
            { onConflict: 'order_number,author' },
        );

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    return NextResponse.json({ ok: true, savedAt: new Date().toISOString() });
}

export async function DELETE(_request: Request, { params }: { params: { id: string } }) {
    const session = await getSession();
    if (!session?.user) return NextResponse.json({ error: 'Неавторизован' }, { status: 401 });

    await supabase
        .from('order_email_drafts')
        .delete()
        .eq('order_number', String(params.id))
        .eq('author', authorOf(session));

    return NextResponse.json({ ok: true });
}
