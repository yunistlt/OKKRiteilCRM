import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getSession } from '@/lib/auth';
import { supabase } from '@/utils/supabase';

export const dynamic = 'force-dynamic';

const KIND_TABLES = {
    document: 'document_templates',
    email: 'email_templates',
} as const;

const PatchSchema = z.object({
    kind: z.enum(['document', 'email']),
    name: z.string().min(1).max(120).optional(),
    subject: z.string().min(1).max(300).optional(),
    body: z.string().min(1).optional(),
    orientation: z.enum(['portrait', 'landscape']).optional(),
    page_format: z.string().max(20).optional(),
    active: z.boolean().optional(),
    sort_order: z.number().int().optional(),
});

/** Правка шаблона — только администратор. */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
    const session = await getSession();
    if (!session || session.user.role !== 'admin') {
        return NextResponse.json({ error: 'forbidden' }, { status: 403 });
    }

    const { id } = await params;

    let body: z.infer<typeof PatchSchema>;
    try {
        body = PatchSchema.parse(await req.json());
    } catch (e: any) {
        return NextResponse.json({ error: 'invalid_body', details: e?.errors ?? String(e) }, { status: 400 });
    }

    const { kind, ...patch } = body;
    if (!Object.keys(patch).length) {
        return NextResponse.json({ error: 'nothing_to_update' }, { status: 400 });
    }

    const { data, error } = await supabase
        .from(KIND_TABLES[kind])
        .update(patch)
        .eq('id', id)
        .select()
        .single();

    if (error) {
        return NextResponse.json({ error: 'update_failed', details: error.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true, template: data });
}

/** Удаление шаблона — только администратор. */
export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
    const session = await getSession();
    if (!session || session.user.role !== 'admin') {
        return NextResponse.json({ error: 'forbidden' }, { status: 403 });
    }

    const { id } = await params;
    const kind = new URL(req.url).searchParams.get('kind');
    if (kind !== 'document' && kind !== 'email') {
        return NextResponse.json({ error: 'kind_required' }, { status: 400 });
    }

    const { error } = await supabase.from(KIND_TABLES[kind]).delete().eq('id', id);
    if (error) {
        return NextResponse.json({ error: 'delete_failed', details: error.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
}
