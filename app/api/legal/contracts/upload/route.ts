import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import {
    assertLegalOrderAccess,
    buildLegalContractStoragePath,
    LEGAL_CONTRACT_BUCKET,
    legalContractUploadRequestSchema,
} from '@/lib/legal-contracts';
import { supabase } from '@/utils/supabase';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
    try {
        const session = await getSession();
        if (!session?.user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const body = await request.json();
        const parsed = legalContractUploadRequestSchema.safeParse(body);
        if (!parsed.success) {
            return NextResponse.json({ error: parsed.error.issues[0]?.message || 'Invalid request payload' }, { status: 400 });
        }

        const { order_id, title, file_name, file_type, file_size } = parsed.data;
        await assertLegalOrderAccess(session, order_id);

        const storagePath = buildLegalContractStoragePath(order_id, file_name);
        const { data: uploadData, error: uploadError } = await supabase.storage
            .from(LEGAL_CONTRACT_BUCKET)
            .createSignedUploadUrl(storagePath, { upsert: false });

        if (uploadError) {
            throw uploadError;
        }

        const { data: review, error: reviewError } = await supabase
            .from('legal_contract_reviews')
            .insert({
                order_id,
                title: title || file_name,
                file_url: storagePath,
                original_file_url: null,
                file_name,
                storage_bucket: LEGAL_CONTRACT_BUCKET,
                storage_path: storagePath,
                content_type: file_type,
                file_size_bytes: file_size,
                upload_status: 'pending_upload',
                scan_status: 'pending',
                analysis_status: 'queued',
                created_by: session.user.id,
            } as any)
            .select('id, order_id, title, storage_path, upload_status, scan_status, analysis_status')
            .single();

        if (reviewError) {
            throw reviewError;
        }

        await supabase.from('legal_audit_log').insert({
            action: 'legal_contract_upload_prepared',
            entity: 'legal_contract_review',
            entity_id: review.id,
            performed_by: session.user.id,
            details: {
                order_id,
                title: title || file_name,
                file_name,
                file_type,
                file_size,
                storage_path: storagePath,
            },
        });

        return NextResponse.json({
            review,
            upload_url: uploadData.signedUrl,
            token: uploadData.token,
            file_path: storagePath,
            bucket: LEGAL_CONTRACT_BUCKET,
        });
    } catch (error: any) {
        return NextResponse.json({ error: error?.message || 'Failed to prepare contract upload' }, { status: 500 });
    }
}