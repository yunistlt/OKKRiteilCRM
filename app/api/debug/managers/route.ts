import { NextResponse } from 'next/server';
import { supabase } from '@/utils/supabase';

export async function GET() {
    const { data } = await supabase.from('managers').select('id, first_name, last_name');
    return NextResponse.json(data);
}
