import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { assertLegalOrderAccess, legalContractReviewListQuerySchema } from '@/lib/legal-contracts';
import { supabase } from '@/utils/supabase';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
    try {
        const session = await getSession();
        if (!session?.user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const { searchParams } = new URL(request.url);
        const parsed = legalContractReviewListQuerySchema.safeParse({
            orderId: searchParams.get('orderId') || '',
        });

        if (!parsed.success) {
            return NextResponse.json({ error: parsed.error.issues[0]?.message || 'orderId is required' }, { status: 400 });
        }

        const orderId = parsed.data.orderId;
        await assertLegalOrderAccess(session, orderId);

        const { data, error } = await supabase
            .from('legal_contract_reviews')
            .select('id, order_id, title, file_name, content_type, file_size_bytes, upload_status, scan_status, analysis_status, analysis_error, risk_score, extracted_data, reviewed_at, updated_at')
            .eq('order_id', orderId)
            .order('reviewed_at', { ascending: false });

        if (error) throw error;

        return NextResponse.json({ reviews: data || [] });
    } catch (error: any) {
        return NextResponse.json({ error: error?.message || 'Failed to load contract reviews' }, { status: 500 });
    }
}