import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { supabase } from '@/utils/supabase';

export const dynamic = 'force-dynamic';

// GET /api/shtab/tamara/memory — что Тамара держит в памяти.
//
// Память видна владельцу целиком и правится им: агент, который помнит что-то
// про тебя, а показать этого не может, доверия не заслуживает.

export async function GET(req: NextRequest) {
    try {
        const session = await getSession(req);
        if (!session?.user) return NextResponse.json({ error: 'Неавторизован' }, { status: 401 });

        const { data, error } = await supabase
            .from('shtab_tamara_memory')
            .select('id, fact, kind, chat_id, active, created_at')
            .eq('active', true)
            .order('created_at', { ascending: false })
            .limit(200);
        if (error) throw new Error(error.message);
        return NextResponse.json({ memory: data ?? [] });
    } catch (e: any) {
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}
