
import { NextResponse } from 'next/server';
import { supabase } from '@/utils/supabase';

export async function POST(request: Request) {
    try {
        const body = await request.json();
        const { violation_id, status, comment } = body;

        if (!violation_id || !status) {
            return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
        }

        // Validate status
        if (!['pending', 'confirmed', 'rejected'].includes(status)) {
            return NextResponse.json({ error: 'Invalid status' }, { status: 400 });
        }

        const { data, error } = await supabase
            .from('okk_violations')
            .update({
                status,
                controller_comment: comment,
                // Optionally update updated_at if you have that column
            })
            .eq('id', violation_id)
            .select()
            .single();

        if (error) throw error;

        return NextResponse.json(data);
    } catch (e: any) {
        console.error('Feedback Error:', e);
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}
