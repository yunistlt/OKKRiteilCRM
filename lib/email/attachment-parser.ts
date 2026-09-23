import mammoth from 'mammoth';
import * as XLSX from 'xlsx';
import { extractPdfText } from '@/lib/pdf-text';
import { decodeTextBuffer } from '@/lib/text-decode';

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
            return normalizeText(decodeTextBuffer(buffer));
        }

        if (ext === 'csv' || ext === 'tsv') {
            // CSV читается как текст, а не таблицей: разделители и кавычки
            // модель разбирает сама, а вот потеря кодировки её обманет молча.
            // Через XLSX csv тоже проходит, но он всегда считает файл UTF-8 —
            // а русские выгрузки чаще в windows-1251.
            return normalizeText(decodeTextBuffer(buffer));
        }

        if (ext === 'docx' || ext === 'doc') {
            const result = await mammoth.extractRawText({ buffer });
            return normalizeText(result.value);
        }

        if (ext === 'pdf') {
            // Через общий хелпер: у pdf-parse сменилось API, и вызов по-старому
            // не ронял разбор, а молча отдавал пустой текст.
            return normalizeText(await extractPdfText(buffer));
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
