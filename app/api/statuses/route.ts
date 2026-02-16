
import { NextResponse } from 'next/server';
import { supabase } from '@/utils/supabase';

export const dynamic = 'force-dynamic';

export async function GET() {
    try {
        const { data, error } = await supabase
            .from('statuses')
            .select('code, name')
            .eq('is_working', true)
            .eq('is_active', true)
            .order('name');

        if (error) throw error;
        return NextResponse.json(data);
    } catch (e: any) {
        console.error('[Statuses API] Error:', e);
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}
