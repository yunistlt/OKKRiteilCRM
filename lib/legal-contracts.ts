// Сохраняет версию после анализа
import { supabase } from '@/utils/supabase';
export async function saveContractReviewVersion({
    reviewId,
    fileUrl,
    extractedText,
    extractedData,
    riskScore,
    analysisStatus,
    analysisError,
    createdBy,
    versionNumber
}: {
    reviewId: number;
    fileUrl?: string | null;
    extractedText?: string | null;
    extractedData?: any;
    riskScore?: string | null;
    analysisStatus?: string | null;
    analysisError?: string | null;
    createdBy: string;
    versionNumber: number;
}) {
    await supabase.from('legal_contract_review_versions').insert({
        review_id: reviewId,
        version_number: versionNumber,
        file_url: fileUrl,
        extracted_text: extractedText,
        extracted_data: extractedData,
        risk_score: riskScore,
        analysis_status: analysisStatus,
        analysis_error: analysisError,
        created_by: createdBy,
    });
}
import { z } from 'zod';
import { loadConsultantOrder } from '@/lib/okk-consultant-context';
import type { AppSession } from '@/lib/auth';

export const LEGAL_CONTRACT_BUCKET = 'legal-contracts';
export const LEGAL_CONTRACT_MAX_FILE_SIZE_BYTES = 25 * 1024 * 1024;

const allowedContractMimeTypes = new Set([
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'text/plain',
]);

export const legalContractUploadRequestSchema = z.object({
    order_id: z.number().int().positive(),
    title: z.string().trim().min(3).max(160).optional().nullable(),
    file_name: z.string().trim().min(1).max(255),
    file_type: z.string().trim().min(1).max(200).refine((value) => allowedContractMimeTypes.has(value), {
        message: 'Unsupported contract type',
    }),
    file_size: z.number().int().min(1).max(LEGAL_CONTRACT_MAX_FILE_SIZE_BYTES),
});

export const legalContractUploadCompleteSchema = z.object({
    review_id: z.number().int().positive(),
    upload_status: z.enum(['uploaded', 'failed']).default('uploaded'),
    file_url: z.string().trim().url().optional().nullable(),
    error: z.string().trim().max(400).optional().nullable(),
});

export const legalContractReviewListQuerySchema = z.object({
    orderId: z.coerce.number().int().positive(),
});

export const legalContractAnalyzeRequestSchema = z.object({
    review_id: z.number().int().positive(),
});

export function sanitizeLegalFileName(fileName: string) {
    const sanitized = fileName
        .normalize('NFKC')
        .replace(/[\\/]/g, '-')
        .replace(/[^a-zA-Z0-9._()\-\sа-яА-ЯёЁ]/g, '_')
        .replace(/\s+/g, ' ')
        .trim();

    return sanitized.slice(0, 140) || 'contract';
}

export function buildLegalContractStoragePath(orderId: number, fileName: string) {
    return `${orderId}/${Date.now()}_${sanitizeLegalFileName(fileName)}`;
}

export async function assertLegalOrderAccess(session: AppSession, orderId: number) {
    const retailCrmManagerId = session.user.retail_crm_manager_id ? Number(session.user.retail_crm_manager_id) : null;
    await loadConsultantOrder(orderId, session.user.role || 'admin', retailCrmManagerId);
}

export function formatPendingScanSummary(scanStatus: string, analysisStatus: string) {
    if (scanStatus === 'pending') {
        return 'Антивирусная проверка ещё не подключена к внешнему движку: файл помечен как pending и требует ручного контроля.';
    }

    if (analysisStatus === 'queued') {
        return 'Файл загружен и ожидает следующего этапа анализа.';
    }

    return 'Статус обработки обновлён.';
}