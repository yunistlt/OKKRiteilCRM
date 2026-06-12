
import { NextResponse } from 'next/server';
import { supabase } from '@/utils/supabase';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
    try {
        const { searchParams } = new URL(req.url);
        // scope=all — полный каталог (включая нерабочие/неактивные) для резолва имён статусов в UI.
        // По умолчанию — только рабочие активные статусы (выпадающие списки правил и т.п.).
        const all = searchParams.get('scope') === 'all';

        let query = supabase.from('statuses').select('code, name');
        if (!all) {
            query = query.eq('is_working', true).eq('is_active', true);
        }
        const { data, error } = await query.order('name');

        if (error) throw error;
        return NextResponse.json(data);
    } catch (e: any) {
        console.error('[Statuses API] Error:', e);
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}
