// Воркер разбора документов исполнительного производства.
// Берёт карточки с parse_status='queued', вытаскивает текст каждого непрочитанного
// документа (PDF/DOCX/скан через OCR), кладёт СЫРОЙ текст в базу, затем извлекает поля
// и пишет их черновиком с доказательством. Бот не завершает карточку — только готовит.
import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/utils/supabase';
import { extractTextFromContract } from '@/lib/legal-contract-analysis';
import { scanContractFile } from '@/lib/legal-antivirus';
import { extractEnforcementFields, detectDocKind } from '@/lib/legal-enforcement/extract';
import { saveExtractedFields, recalcCaseStatus } from '@/lib/legal-enforcement/facts';
import { persistSuggestions, suggestPaymentsForCase } from '@/lib/legal-enforcement/payment-match';
import { ENFORCEMENT_BUCKET, isArchiveFile } from '@/lib/legal-enforcement/types';
import { unpackArchiveDocument } from '@/lib/legal-enforcement/archive';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const BATCH_SIZE = 3;

function ensureAuthorized(req: NextRequest) {
  const authHeader = req.headers.get('authorization');
  if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    throw new Error('Unauthorized');
  }
}

async function handle(req: NextRequest) {
  ensureAuthorized(req);

  const { data: cases, error } = await supabase
    .from('legal_enforcement_cases')
    .select('id')
    .eq('parse_status', 'queued')
    .order('updated_at', { ascending: true })
    .limit(BATCH_SIZE);
  if (error) throw error;
  if (!cases || cases.length === 0) return NextResponse.json({ ok: true, parsed: 0 });

  let parsed = 0;

  for (const caseRow of cases) {
    const caseId = Number(caseRow.id);
    try {
      await supabase
        .from('legal_enforcement_cases')
        .update({ parse_status: 'processing', updated_at: new Date().toISOString() })
        .eq('id', caseId);

      const { data: documents } = await supabase
        .from('legal_enforcement_documents')
        .select('id, file_name, storage_bucket, storage_path, content_type, extract_status, scan_status, upload_status')
        .eq('case_id', caseId)
        .eq('upload_status', 'uploaded')
        .in('extract_status', ['queued', 'failed']);

      const warnings: string[] = [];

      for (const document of documents || []) {
        // Антивирус — прежний мок из контура договоров, но заражённое дальше не идёт.
        if (document.scan_status === 'pending') {
          const scan = await scanContractFile(document.storage_bucket || ENFORCEMENT_BUCKET, document.storage_path);
          await supabase
            .from('legal_enforcement_documents')
            .update({ scan_status: scan.status, updated_at: new Date().toISOString() })
            .eq('id', document.id);
          if (scan.status === 'infected') {
            warnings.push(`Файл «${document.file_name}» отклонён антивирусом: ${scan.details || ''}`.trim());
            await supabase
              .from('legal_enforcement_documents')
              .update({ extract_status: 'failed', extract_warnings: { scan: scan.details || 'infected' } })
              .eq('id', document.id);
            continue;
          }
        }

        // Архив — не документ, а пачка документов: раскладываем и идём дальше.
        // Разобраны они будут этим же воркером на следующем заходе.
        if (isArchiveFile(document.content_type, document.file_name)) {
          try {
            const unpacked = await unpackArchiveDocument({
              caseId,
              documentId: Number(document.id),
              bucket: document.storage_bucket || ENFORCEMENT_BUCKET,
              storagePath: document.storage_path,
            });
            warnings.push(`Архив «${document.file_name}»: файлов ${unpacked.created}` +
              (unpacked.skipped.length > 0 ? `, пропущено ${unpacked.skipped.length}` : ''));
            // Ставим карточку снова в очередь — распакованные файлы ждут разбора.
            await supabase
              .from('legal_enforcement_cases')
              .update({ parse_status: 'queued', updated_at: new Date().toISOString() })
              .eq('id', caseId);
          } catch (err: any) {
            warnings.push(`Архив «${document.file_name}» не распаковался: ${String(err?.message || err)}`);
            await supabase
              .from('legal_enforcement_documents')
              .update({ extract_status: 'failed', extract_warnings: { archive: String(err?.message || err) } })
              .eq('id', document.id);
          }
          continue;
        }

        const extraction = await extractTextFromContract({
          bucket: document.storage_bucket || ENFORCEMENT_BUCKET,
          storagePath: document.storage_path,
          contentType: document.content_type,
          fileName: document.file_name,
        });

        if (!extraction.text) {
          await supabase
            .from('legal_enforcement_documents')
            .update({
              extract_status: extraction.status === 'failed' ? 'failed' : 'manual_review_required',
              extract_warnings: { warnings: extraction.warnings },
              updated_at: new Date().toISOString(),
            })
            .eq('id', document.id);
          warnings.push(`«${document.file_name}»: текст не извлечён — ${extraction.warnings.join('; ')}`);
          continue;
        }

        const outcome = await extractEnforcementFields(extraction.text);

        await supabase
          .from('legal_enforcement_documents')
          .update({
            raw_text: extraction.text,
            doc_kind: outcome.doc_kind || detectDocKind(extraction.text) || 'other',
            extract_status: 'completed',
            extract_warnings: outcome.warnings.length > 0 ? { warnings: outcome.warnings } : null,
            updated_at: new Date().toISOString(),
          })
          .eq('id', document.id);

        await saveExtractedFields({ caseId, documentId: Number(document.id), fields: outcome.fields });
        warnings.push(...outcome.warnings);
      }

      await supabase
        .from('legal_enforcement_cases')
        .update({
          parse_status: 'completed',
          parse_error: warnings.length > 0 ? warnings.join(' | ').slice(0, 2000) : null,
          parsed_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('id', caseId);

      // Платежи бот тоже предлагает сам — человек только подтверждает.
      try {
        const suggestions = await suggestPaymentsForCase(caseId);
        await persistSuggestions(caseId, suggestions);
      } catch {
        // Подбор платежей не должен ронять разбор документов.
      }

      await recalcCaseStatus(caseId);
      parsed++;
    } catch (err: any) {
      await supabase
        .from('legal_enforcement_cases')
        .update({
          parse_status: 'failed',
          parse_error: String(err?.message || err).slice(0, 2000),
          updated_at: new Date().toISOString(),
        })
        .eq('id', caseId);
    }
  }

  return NextResponse.json({ ok: true, parsed });
}

export async function GET(req: NextRequest) {
  try {
    return await handle(req);
  } catch (error: any) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  return GET(req);
}
