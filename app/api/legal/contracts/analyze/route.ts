import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { extractTextFromContract } from '@/lib/legal-contract-analysis';
import { assertLegalOrderAccess, legalContractAnalyzeRequestSchema } from '@/lib/legal-contracts';
import { supabase } from '@/utils/supabase';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST(request: Request) {
    try {
        const session = await getSession();
        if (!session?.user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const body = await request.json();
        const parsed = legalContractAnalyzeRequestSchema.safeParse(body);
        if (!parsed.success) {
            return NextResponse.json({ error: parsed.error.issues[0]?.message || 'review_id is required' }, { status: 400 });
        }
        const reviewId = parsed.data.review_id;

        const { data: review, error: reviewError } = await supabase
            .from('legal_contract_reviews')
            .select('id, order_id, title, file_name, storage_bucket, storage_path, content_type, upload_status, scan_status, analysis_status')
            .eq('id', reviewId)
            .maybeSingle();

        if (reviewError) throw reviewError;
        if (!review) {
            return NextResponse.json({ error: 'Review not found' }, { status: 404 });
        }

        await assertLegalOrderAccess(session, Number(review.order_id));

        if (review.upload_status !== 'uploaded') {
            return NextResponse.json({ error: 'Файл ещё не загружен полностью' }, { status: 400 });
        }

        // Ставим задачу асинхронного анализа
        await supabase
            .from('legal_contract_reviews')
            .update({ analysis_status: 'queued', analysis_error: null, updated_at: new Date().toISOString() })
            .eq('id', reviewId);

        // enqueue job
        const { enqueueLegalContractAnalyzeJob } = await import('@/lib/system-jobs');
        await enqueueLegalContractAnalyzeJob(reviewId);

        return NextResponse.json({ ok: true, status: 'queued' });
    } catch (error: any) {
        return NextResponse.json({ error: error?.message || 'Failed to analyze contract' }, { status: 500 });
    }
}