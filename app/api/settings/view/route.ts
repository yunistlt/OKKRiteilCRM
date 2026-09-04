import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getSession } from '@/lib/auth';
import { supabase } from '@/utils/supabase';

export const dynamic = 'force-dynamic';

const BodySchema = z.object({
    viewKey: z.string().min(1).max(60),
    settings: z.record(z.string(), z.any()),
});

/** Личные настройки экрана: что показывать и в каком порядке. */
export async function GET(req: Request) {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

    const viewKey = new URL(req.url).searchParams.get('viewKey');
    if (!viewKey) return NextResponse.json({ error: 'viewKey_required' }, { status: 400 });

    const { data } = await supabase
        .from('user_view_settings')
        .select('settings')
        .eq('user_id', session.user.id)
        .eq('view_key', viewKey)
        .maybeSingle();

    return NextResponse.json({ ok: true, settings: data?.settings ?? null });
}

export async function PUT(req: Request) {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

    let body: z.infer<typeof BodySchema>;
    try {
        body = BodySchema.parse(await req.json());
    } catch (e: any) {
        return NextResponse.json({ error: 'invalid_body', details: e?.errors ?? String(e) }, { status: 400 });
    }

    const { error } = await supabase
        .from('user_view_settings')
        .upsert(
            { user_id: session.user.id, view_key: body.viewKey, settings: body.settings, updated_at: new Date().toISOString() },
            { onConflict: 'user_id,view_key' }
        );

    if (error) {
        console.error('[view-settings] Не удалось сохранить настройку:', error);
        return NextResponse.json({ error: 'save_failed' }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
}
