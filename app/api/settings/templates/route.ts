import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getSession } from '@/lib/auth';
import { supabase } from '@/utils/supabase';

export const dynamic = 'force-dynamic';

const KIND_TABLES = {
    document: 'document_templates',
    email: 'email_templates',
} as const;

type Kind = keyof typeof KIND_TABLES;

function isKind(value: unknown): value is Kind {
    return value === 'document' || value === 'email';
}

const DocumentSchema = z.object({
    kind: z.literal('document'),
    code: z.string().regex(/^[a-z0-9_-]{2,60}$/, 'Код — латиница, цифры, дефис и подчёркивание'),
    name: z.string().min(1).max(120),
    body: z.string().min(1),
    orientation: z.enum(['portrait', 'landscape']).optional(),
    page_format: z.string().max(20).optional(),
    active: z.boolean().optional(),
    sort_order: z.number().int().optional(),
});

const EmailSchema = z.object({
    kind: z.literal('email'),
    code: z.string().regex(/^[a-z0-9_-]{2,60}$/, 'Код — латиница, цифры, дефис и подчёркивание'),
    name: z.string().min(1).max(120),
    subject: z.string().min(1).max(300),
    body: z.string().min(1),
    active: z.boolean().optional(),
    sort_order: z.number().int().optional(),
});

const BodySchema = z.discriminatedUnion('kind', [DocumentSchema, EmailSchema]);

/** Список шаблонов. Читать может любой вошедший — шаблоны нужны менеджеру в работе. */
export async function GET(req: Request) {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

    const kindParam = new URL(req.url).searchParams.get('kind');
    const kinds: Kind[] = isKind(kindParam) ? [kindParam] : ['document', 'email'];
    const onlyActive = new URL(req.url).searchParams.get('active') === 'true';

    const result: Record<string, any[]> = {};

    for (const kind of kinds) {
        let query = supabase.from(KIND_TABLES[kind]).select('*').order('sort_order').order('name');
        if (onlyActive) query = query.eq('active', true);
        const { data, error } = await query;
        if (error) {
            console.error(`[templates] Не удалось прочитать ${KIND_TABLES[kind]}:`, error);
            return NextResponse.json({ error: 'read_failed' }, { status: 500 });
        }
        result[kind] = data || [];
    }

    return NextResponse.json(result);
}

/** Создание шаблона — только администратор. */
export async function POST(req: Request) {
    const session = await getSession();
    if (!session || session.user.role !== 'admin') {
        return NextResponse.json({ error: 'forbidden' }, { status: 403 });
    }

    let body: z.infer<typeof BodySchema>;
    try {
        body = BodySchema.parse(await req.json());
    } catch (e: any) {
        return NextResponse.json({ error: 'invalid_body', details: e?.errors ?? String(e) }, { status: 400 });
    }

    const { kind, ...row } = body;
    const { data, error } = await supabase.from(KIND_TABLES[kind]).insert(row).select().single();

    if (error) {
        const duplicate = error.code === '23505';
        return NextResponse.json(
            { error: duplicate ? 'code_taken' : 'insert_failed', details: error.message },
            { status: duplicate ? 409 : 500 }
        );
    }

    return NextResponse.json({ ok: true, template: data });
}
