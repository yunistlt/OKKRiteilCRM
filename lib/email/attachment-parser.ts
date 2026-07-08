import mammoth from 'mammoth';
import * as XLSX from 'xlsx';

/**
 * Нормализует извлеченный текст: убирает лишние пробелы, переносы строк и дубли.
 */
function normalizeText(text: string): string {
    return text
        .replace(/\r\n/g, '\n')
        .replace(/\r/g, '\n')
        .replace(/\t/g, ' ')
        .replace(/[ \t]+/g, ' ')
        .replace(/\n\s*\n+/g, '\n')
        .trim();
}

/**
 * Извлекает текстовое содержимое из буфера файла вложения в зависимости от его расширения.
 */
export async function extractTextFromBuffer(buffer: Buffer, filename: string): Promise<string> {
    const ext = filename.split('.').pop()?.toLowerCase();
    
    if (!ext || !buffer || buffer.length === 0) {
        return '';
    }

    try {
        if (ext === 'txt') {
            return normalizeText(buffer.toString('utf-8'));
        }

        if (ext === 'docx' || ext === 'doc') {
            const result = await mammoth.extractRawText({ buffer });
            return normalizeText(result.value);
        }

        if (ext === 'pdf') {
            // Динамический импорт pdf-parse по аналогии с legal-contract-analysis.ts
            const pdfParseModule = await import('pdf-parse');
            const pdfParse = (pdfParseModule as any).default || pdfParseModule;
            const result = await pdfParse(buffer);
            return normalizeText(result.text || '');
        }

        if (ext === 'xlsx' || ext === 'xls') {
            const workbook = XLSX.read(buffer, { type: 'buffer' });
            let text = '';
            for (const sheetName of workbook.SheetNames) {
                const sheet = workbook.Sheets[sheetName];
                text += XLSX.utils.sheet_to_txt(sheet) + '\n';
            }
            return normalizeText(text);
        }
    } catch (err: any) {
        console.error(`Ошибка при извлечении текста из файла ${filename}:`, err);
    }

    return '';
}
