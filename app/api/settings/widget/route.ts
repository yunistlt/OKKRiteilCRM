import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/utils/supabase';
import { getSession } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function GET() {
    const { data, error } = await supabase
        .from('widget_settings')
        .select('config, updated_at, updated_by')
        .limit(1)
        .single();

    if (error && error.code !== 'PGRST116') {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json(data?.config ?? {});
}

export async function POST(req: NextRequest) {
    const session = await getSession(req);
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const config = await req.json();

    const { data: existing } = await supabase
        .from('widget_settings')
        .select('id')
        .limit(1)
        .single();

    let error;
    if (existing?.id) {
        ({ error } = await supabase
            .from('widget_settings')
            .update({ config, updated_at: new Date().toISOString(), updated_by: session.user.email })
            .eq('id', existing.id));
    } else {
        ({ error } = await supabase
            .from('widget_settings')
            .insert({ config, updated_by: session.user.email }));
    }

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ success: true });
}
