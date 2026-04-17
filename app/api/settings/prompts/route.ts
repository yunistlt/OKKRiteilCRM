
import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { hasAnyRole } from '@/lib/rbac';
import { supabase } from '@/utils/supabase';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
    try {
        const session = await getSession();
        if (!hasAnyRole(session, ['admin'])) {
            return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
        }

        const { searchParams } = new URL(req.url);
        const key = searchParams.get('key');

        let query = supabase.from('ai_prompts').select('*').order('created_at', { ascending: false });
        if (key) {
            query = query.eq('key', key);
        }

        const { data, error } = await query;
        if (error) throw error;

        return NextResponse.json(data);
    } catch (e: any) {
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}

export async function POST(req: Request) {
    try {
        const session = await getSession();
        if (!hasAnyRole(session, ['admin'])) {
            return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
        }

        const body = await req.json();
        const { key, system_prompt, description, model } = body;

        if (!key || !system_prompt) {
            return NextResponse.json({ error: 'Key and System Prompt are required' }, { status: 400 });
        }

        // Upsert based on key
        const { data, error } = await supabase
            .from('ai_prompts')
            .upsert({
                key,
                system_prompt,
                description,
                model,
                updated_at: new Date().toISOString()
            }, { onConflict: 'key' })
            .select()
            .single();

        if (error) throw error;

        return NextResponse.json(data);
    } catch (e: any) {
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}
