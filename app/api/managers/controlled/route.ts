import { NextResponse } from 'next/server';
import { supabase } from '@/utils/supabase';

export const dynamic = 'force-dynamic';

export async function GET() {
    try {
        const { data, error } = await supabase
            .from('manager_settings')
            .select('id')
            .eq('is_controlled', true);

        if (error) {
            // If table doesn't exist yet, return empty but log for dev
            if (error.code === 'PGRST116' || error.message.includes('relation "manager_settings" does not exist')) {
                return NextResponse.json([]);
            }
            throw error;
        }

        return NextResponse.json(data || []);
    } catch (e: any) {
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}
