import { NextResponse } from 'next/server';
import { supabase } from '@/utils/supabase';
import { getSession } from '@/lib/auth';
import { hasAnyRole } from '@/lib/rbac';

export async function POST(
    req: Request,
    { params }: { params: { id: string; action: string } }
) {
    const session = await getSession();
    if (!hasAnyRole(session, ['admin', 'rop'])) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const { id, action } = params;

    if (action !== 'approve' && action !== 'reject') {
        return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
    }

    const newStatus = action === 'approve' ? 'approved' : 'rejected';
    const timestampField = action === 'approve' ? 'approved_at' : 'rejected_at';

    const { data, error } = await supabase
        .from('ai_outreach_logs')
        .update({
            status: newStatus,
            [timestampField]: new Date().toISOString()
        })
        .eq('id', id)
        .select()
        .single();

    if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, log: data });
}
