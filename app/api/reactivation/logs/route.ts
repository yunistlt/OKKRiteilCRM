import { NextResponse } from 'next/server';
import { supabase } from '@/utils/supabase';

export async function GET(req: Request) {
    const { searchParams } = new URL(req.url);
    const status = searchParams.get('status') || 'awaiting_approval';

    const { data, error } = await supabase
        .from('ai_outreach_logs')
        .select('*')
        .eq('status', status)
        .order('created_at', { ascending: false })
        .limit(50);

    if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, logs: data });
}
