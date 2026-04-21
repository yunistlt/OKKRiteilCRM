import mammoth from 'mammoth';
import { supabase } from '@/utils/supabase';
import { extractTextFromImageBuffer } from '@/lib/legal-ocr';

export type ContractExtractionStatus = 'completed' | 'manual_review_required' | 'failed';

export type ContractExtractionResult = {
    text: string | null;
    status: ContractExtractionStatus;
    warnings: string[];
};

function normalizeExtractedText(value: string) {
    return value
        .replace(/\u0000/g, ' ')
        .replace(/\r/g, '\n')
        .replace(/\t/g, ' ')
        .replace(/\n{3,}/g, '\n\n')
        .replace(/[ ]{2,}/g, ' ')
        .trim();
}

function detectFileKind(contentType: string | null | undefined, fileName: string | null | undefined) {
    const lowerName = String(fileName || '').toLowerCase();
    const normalizedType = String(contentType || '').toLowerCase();

    if (normalizedType === 'text/plain' || lowerName.endsWith('.txt')) return 'txt';
    if (normalizedType === 'application/pdf' || lowerName.endsWith('.pdf')) return 'pdf';
    if (normalizedType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' || lowerName.endsWith('.docx')) return 'docx';
    if (normalizedType === 'application/msword' || lowerName.endsWith('.doc')) return 'doc';
    return 'unknown';
}

export async function downloadContractBuffer(bucket: string, storagePath: string): Promise<Buffer> {
    const { data, error } = await supabase.storage.from(bucket).download(storagePath);
    if (error) throw error;

    const arrayBuffer = await data.arrayBuffer();
    return Buffer.from(arrayBuffer);
}

export async function extractTextFromContract(params: {
    bucket: string;
    storagePath: string;
    contentType?: string | null;
    fileName?: string | null;
}): Promise<ContractExtractionResult> {
    const warnings: string[] = [];
    const fileKind = detectFileKind(params.contentType, params.fileName);
    const buffer = await downloadContractBuffer(params.bucket, params.storagePath);

    try {
        if (fileKind === 'txt') {
            const pdfParseModule = await import('pdf-parse');
            const pdfParse = (pdfParseModule as any).default || pdfParseModule;
            return {
                text: normalizeExtractedText(buffer.toString('utf-8')),
                status: 'completed',
                warnings,
            };
        }

        if (fileKind === 'docx') {
            const result = await mammoth.extractRawText({ buffer });
            if (result.messages.length > 0) {
                warnings.push(...result.messages.map((item) => item.message));
            }

            return {
                text: normalizeExtractedText(result.value),
                status: result.value.trim() ? 'completed' : 'manual_review_required',
                warnings,
            };
        }


        if (fileKind === 'pdf') {
            const pdfParseModule = await import('pdf-parse');
            const pdfParse = (pdfParseModule as any).default || pdfParseModule;
            const result = await pdfParse(buffer);
            const plainText = result.text || '';
            if (plainText.trim().length > 40) {
                return {
                    text: normalizeExtractedText(plainText),
                    status: 'completed',
                    warnings,
                };
            }
            warnings.push('PDF не содержит текстового слоя. Для такого файла нужна ручная валидация или runtime c PDF OCR-конвертацией.');
            return {
                text: null,
                status: 'manual_review_required',
                warnings,
            };
        }

        // Если это изображение (jpeg/png/webp)
        if (params.contentType && params.contentType.startsWith('image/')) {
            try {
                const ocrText = await extractTextFromImageBuffer(buffer);
                return {
                    text: normalizeExtractedText(ocrText),
                    status: ocrText.trim().length > 40 ? 'completed' : 'manual_review_required',
                    warnings,
                };
            } catch (imgErr: any) {
                warnings.push('OCR для изображения не удался: ' + (imgErr?.message || imgErr));
            }
        }

        if (fileKind === 'doc') {
            warnings.push('Формат .doc не поддерживается для автоматического извлечения. Нужна ручная валидация или конвертация в .docx/.pdf.');
            return {
                text: null,
                status: 'manual_review_required',
                warnings,
            };
        }

        warnings.push('Неизвестный тип файла. Нужна ручная валидация.');
        return {
            text: null,
            status: 'manual_review_required',
            warnings,
        };
    } catch (error: any) {
        return {
            text: null,
            status: 'failed',
            warnings: [...warnings, error?.message || 'Extraction failed'],
        };
    }
}