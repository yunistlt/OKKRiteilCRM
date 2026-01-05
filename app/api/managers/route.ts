import { NextResponse } from 'next/server';
import { supabase } from '@/utils/supabase';

// Force dynamic to ensure we always get partial updates
export const dynamic = 'force-dynamic';

export async function GET() {
    try {
        const { data, error } = await supabase
            .from('managers')
            .select('*')
            .order('last_name', { ascending: true, nullsFirst: false });

        if (error) throw error;

        return NextResponse.json(data || []);
    } catch (e: any) {
        console.error('Error fetching managers:', e);
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}
