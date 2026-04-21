import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import {
    assertLegalOrderAccess,
    formatPendingScanSummary,
    LEGAL_CONTRACT_BUCKET,
    legalContractUploadCompleteSchema,
} from '@/lib/legal-contracts';
import { enqueueLegalContractScanJob } from '@/lib/system-jobs';
import { supabase } from '@/utils/supabase';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
    try {
        const session = await getSession();
        if (!session?.user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const body = await request.json();
        const parsed = legalContractUploadCompleteSchema.safeParse(body);
        if (!parsed.success) {
            return NextResponse.json({ error: parsed.error.issues[0]?.message || 'Invalid request payload' }, { status: 400 });
        }

        const { review_id, upload_status, file_url, error } = parsed.data;
        const { data: review, error: reviewError } = await supabase
            .from('legal_contract_reviews')
            .select('id, order_id, storage_path, scan_status, analysis_status')
            .eq('id', review_id)
            .maybeSingle();

        if (reviewError) throw reviewError;
        if (!review) {
            return NextResponse.json({ error: 'Review not found' }, { status: 404 });
        }

        await assertLegalOrderAccess(session, Number(review.order_id));

        const resolvedFileUrl = file_url || review.storage_path;

        const { data: updated, error: updateError } = await supabase
            .from('legal_contract_reviews')
            .update({
                file_url: upload_status === 'uploaded' ? resolvedFileUrl : null,
                original_file_url: upload_status === 'uploaded' ? resolvedFileUrl : null,
                upload_status,
                analysis_error: error || null,
                updated_at: new Date().toISOString(),
            })
            .eq('id', review_id)
            .select('id, order_id, title, file_name, upload_status, scan_status, analysis_status, updated_at')
            .single();

        if (updateError) throw updateError;

        await supabase.from('legal_audit_log').insert({
            action: upload_status === 'uploaded' ? 'legal_contract_upload_completed' : 'legal_contract_upload_failed',
            entity: 'legal_contract_review',
            entity_id: review_id,
            performed_by: session.user.id,
            details: {
                order_id: review.order_id,
                storage_path: review.storage_path,
                upload_status,
                error: error || null,
            },
        });

        // Если после upload scan_status == 'pending', ставим в очередь на антивирусную проверку
        if (updated.scan_status === 'pending') {
            await enqueueLegalContractScanJob(updated.id);
        }
        return NextResponse.json({
            review: updated,
            summary: formatPendingScanSummary(updated.scan_status, updated.analysis_status),
        });
    } catch (error: any) {
        return NextResponse.json({ error: error?.message || 'Failed to finalize contract upload' }, { status: 500 });
    }
}