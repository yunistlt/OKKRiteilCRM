import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/utils/supabase';
import { extractTextFromContract } from '@/lib/legal-contract-analysis';
import { evaluateLegalContractText } from '@/lib/legal-evaluator';
import { saveContractReviewVersion } from '@/lib/legal-contracts';

export const dynamic = 'force-dynamic';
const WORKER_KEY = 'legal_contract_analyze';

function ensureAuthorized(req: NextRequest) {
  const authHeader = req.headers.get('authorization');
  if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    throw new Error('Unauthorized');
  }
}

export async function POST(req: NextRequest) {
  try {
    ensureAuthorized(req);
    // Найти все ревью со статусом analysis_status = 'queued' (ограничим 5 за раз)
    const { data: reviews, error } = await supabase
      .from('legal_contract_reviews')
      .select('id, order_id, file_name, storage_bucket, storage_path, content_type, latest_version')
      .eq('analysis_status', 'queued')
      .limit(5);
    if (error) throw error;
    if (!reviews || reviews.length === 0) {
      return NextResponse.json({ ok: true, analyzed: 0 });
    }
    let analyzed = 0;
    for (const review of reviews) {
      try {
        await supabase
          .from('legal_contract_reviews')
          .update({ analysis_status: 'processing', updated_at: new Date().toISOString() })
          .eq('id', review.id);
        const extraction = await extractTextFromContract({
          bucket: review.storage_bucket || 'legal-contracts',
          storagePath: review.storage_path || review.file_name,
          contentType: review.content_type,
          fileName: review.file_name,
        });
        if (extraction.status === 'failed' || !extraction.text) {
          await supabase
            .from('legal_contract_reviews')
            .update({
              analysis_status: 'failed',
              analysis_error: extraction.warnings.join(' | ') || 'Не удалось извлечь текст',
              updated_at: new Date().toISOString(),
            })
            .eq('id', review.id);
          continue;
        }
        const evaluation = evaluateLegalContractText(extraction.text);
        const nextVersion = (review.latest_version || 1) + 1;
        const { data: updated } = await supabase
          .from('legal_contract_reviews')
          .update({
            extracted_text: extraction.text,
            extracted_data: {
              extraction_status: extraction.status,
              warnings: extraction.warnings,
              evaluation,
            },
            risk_score: evaluation.risk_score,
            analysis_status: 'completed',
            analysis_error: extraction.warnings.length > 0 ? extraction.warnings.join(' | ') : null,
            latest_version: nextVersion,
            updated_at: new Date().toISOString(),
          })
          .eq('id', review.id)
          .select('id, order_id, risk_score, analysis_status, analysis_error, extracted_text, extracted_data, updated_at, latest_version')
          .single();
        await saveContractReviewVersion({
          reviewId: review.id,
          fileUrl: updated?.file_url,
          extractedText: updated?.extracted_text,
          extractedData: updated?.extracted_data,
          riskScore: updated?.risk_score,
          analysisStatus: updated?.analysis_status,
          analysisError: updated?.analysis_error,
          createdBy: 'system',
          versionNumber: updated?.latest_version || nextVersion,
        });
        analyzed++;
      } catch (err) {
        await supabase
          .from('legal_contract_reviews')
          .update({ analysis_status: 'failed', analysis_error: String(err), updated_at: new Date().toISOString() })
          .eq('id', review.id);
      }
    }
    return NextResponse.json({ ok: true, analyzed });
  } catch (error: any) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }
}
