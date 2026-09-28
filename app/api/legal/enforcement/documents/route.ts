// Загрузка документов карточки: подписанный URL (POST) и подтверждение загрузки (PATCH).
// Тот же порядок, что у договоров Льва: файл летит в Storage напрямую, минуя наш рантайм.
import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { supabase } from '@/utils/supabase';
import { writeLegalAudit } from '@/lib/legal-audit';
import {
  buildEnforcementStoragePath,
  ENFORCEMENT_BUCKET,
  enforcementDocumentCompleteSchema,
  enforcementDocumentUploadSchema,
} from '@/lib/legal-enforcement/types';
import { enqueueLegalEnforcementParseJob } from '@/lib/system-jobs';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    const session = await getSession();
    if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const parsed = enforcementDocumentUploadSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message || 'Проверьте файл' }, { status: 400 });
    }

    const { case_id, title, file_name, file_type, file_size } = parsed.data;

    const { data: caseRow } = await supabase
      .from('legal_enforcement_cases')
      .select('id')
      .eq('id', case_id)
      .maybeSingle();
    if (!caseRow) return NextResponse.json({ error: 'Карточка не найдена' }, { status: 404 });

    const storagePath = buildEnforcementStoragePath(case_id, file_name);
    const { data: upload, error: uploadError } = await supabase.storage
      .from(ENFORCEMENT_BUCKET)
      .createSignedUploadUrl(storagePath, { upsert: false });
    if (uploadError) throw uploadError;

    const { data: document, error: docError } = await supabase
      .from('legal_enforcement_documents')
      .insert({
        case_id,
        title: title || file_name,
        file_name,
        storage_bucket: ENFORCEMENT_BUCKET,
        storage_path: storagePath,
        content_type: file_type,
        file_size_bytes: file_size,
        upload_status: 'pending_upload',
        scan_status: 'pending',
        extract_status: 'queued',
        uploaded_by: session.user.id,
      })
      .select('id, case_id, title, file_name, upload_status, extract_status')
      .single();
    if (docError) throw docError;

    return NextResponse.json({
      document,
      upload_url: upload.signedUrl,
      token: upload.token,
      bucket: ENFORCEMENT_BUCKET,
      file_path: storagePath,
    });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || 'Не удалось подготовить загрузку' }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  try {
    const session = await getSession();
    if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const parsed = enforcementDocumentCompleteSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message || 'Проверьте запрос' }, { status: 400 });
    }

    const { document_id, upload_status, error: uploadError } = parsed.data;

    const { data: document, error } = await supabase
      .from('legal_enforcement_documents')
      .update({
        upload_status,
        extract_warnings: uploadError ? { upload_error: uploadError } : null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', document_id)
      .select('id, case_id, upload_status')
      .single();
    if (error) throw error;

    // Файл на месте — сразу ставим разбор в очередь, человеку кнопку нажимать не обязательно.
    if (upload_status === 'uploaded') {
      await supabase
        .from('legal_enforcement_cases')
        .update({ parse_status: 'queued', parse_error: null, updated_at: new Date().toISOString() })
        .eq('id', document.case_id);
      await enqueueLegalEnforcementParseJob(Number(document.case_id));
    }

    await writeLegalAudit({
      action: 'legal_enforcement_document_uploaded',
      entity: 'legal_enforcement_document',
      entityId: document.id,
      performedBy: String(session.user.id),
      details: { upload_status, error: uploadError || null },
    });

    return NextResponse.json({ document });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || 'Не удалось подтвердить загрузку' }, { status: 500 });
  }
}
