
import { NextResponse } from 'next/server';
import { supabase } from '@/utils/supabase';

export const dynamic = 'force-dynamic';

export async function GET() {
    const { data, error } = await supabase
        .from('system_prompts')
        .select('*')
        .order('key');

    if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json(data);
}

export async function POST(req: Request) {
    const body = await req.json();
    const { key, content, description } = body;

    if (!key || !content) {
        return NextResponse.json({ error: 'Key and content required' }, { status: 400 });
    }

    const { data, error } = await supabase
        .from('system_prompts')
        .upsert({ key, content, description, updated_at: new Date().toISOString() })
        .select()
        .single();

    if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json(data);
}
