import { NextResponse } from 'next/server';
import { supabase } from '@/utils/supabase';

export async function GET() {
    const { data } = await supabase.from('statuses').select('code, name');
    return NextResponse.json(data);
}
