import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getSession } from '@/lib/auth';
import { supabase } from '@/utils/supabase';

export const dynamic = 'force-dynamic';

const CreateSchema = z.object({
    name: z.string().min(1).max(80),
    filters: z.record(z.string(), z.any()),
    shared: z.boolean().optional(),   // общий для отдела или личный
});

/** Сохранённые наборы фильтров: общие плюс личные текущего пользователя. */
export async function GET() {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

    const { data, error } = await supabase
        .from('order_filter_presets')
        .select('*')
        .or(`owner_user_id.is.null,owner_user_id.eq.${session.user.id}`)
        .order('sort_order')
        .order('name');

    if (error) {
        console.error('[filter-presets] Не удалось прочитать фильтры:', error);
        return NextResponse.json({ error: 'read_failed' }, { status: 500 });
    }

    return NextResponse.json({ ok: true, presets: data || [] });
}

export async function POST(req: Request) {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

    let body: z.infer<typeof CreateSchema>;
    try {
        body = CreateSchema.parse(await req.json());
    } catch (e: any) {
        return NextResponse.json({ error: 'invalid_body', details: e?.errors ?? String(e) }, { status: 400 });
    }

    // Общий фильтр заводит только администратор или РОП — иначе отдел завалит панель личными.
    const canShare = ['admin', 'rop'].includes(session.user.role);
    const owner = body.shared && canShare ? null : session.user.id;

    const { data, error } = await supabase
        .from('order_filter_presets')
        .insert({ name: body.name, filters: body.filters, owner_user_id: owner })
        .select()
        .single();

    if (error) {
        return NextResponse.json({ error: 'insert_failed', details: error.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true, preset: data });
}

export async function DELETE(req: Request) {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

    const id = new URL(req.url).searchParams.get('id');
    if (!id) return NextResponse.json({ error: 'id_required' }, { status: 400 });

    const { data: preset } = await supabase
        .from('order_filter_presets')
        .select('owner_user_id')
        .eq('id', id)
        .maybeSingle();

    if (!preset) return NextResponse.json({ error: 'not_found' }, { status: 404 });

    const isOwner = preset.owner_user_id === session.user.id;
    const canManageShared = preset.owner_user_id === null && ['admin', 'rop'].includes(session.user.role);
    if (!isOwner && !canManageShared) {
        return NextResponse.json({ error: 'forbidden' }, { status: 403 });
    }

    const { error } = await supabase.from('order_filter_presets').delete().eq('id', id);
    if (error) return NextResponse.json({ error: 'delete_failed' }, { status: 500 });

    return NextResponse.json({ ok: true });
}
