/**
 * Прикрепление файлов к заказу RetailCRM (API v5, раздел «Файлы»).
 * Два шага на файл:
 *   1) POST /api/v5/files/upload — тело = СЫРОЙ бинарь файла (Content-Type = mime файла) → { file: { id } };
 *   2) POST /api/v5/files/{id}/edit — file={"filename":…,"attachment":[{"order":{"id":<id>}}]} —
 *      привязывает файл к заказу (вкладка «Файлы» заказа).
 * Используется Катериной: когда из письма создаётся заказ, его вложения (обычно там ТЗ) едут в заказ.
 */
import { getCrmConfig } from './leads';

/** Лимит размера одного файла. Крупнее — пропускаем (у RetailCRM есть ограничение на загрузку). */
const MAX_FILE_BYTES = 20 * 1024 * 1024;

export interface EmailFile {
    filename: string | null;
    contentType: string | null;
    content: Buffer;
}

/** Загружает файл в RetailCRM, возвращает id загруженного файла. */
async function uploadFile(content: Buffer, contentType: string): Promise<number> {
    const { url: baseUrl, key } = await getCrmConfig();
    const res = await fetch(`${baseUrl}/api/v5/files/upload?apiKey=${key}`, {
        method: 'POST',
        headers: { 'Content-Type': contentType || 'application/octet-stream' },
        body: content as any,
    });
    const data = await res.json().catch(() => ({} as any));
    const id = data?.file?.id;
    if (!data?.success || !id) {
        throw new Error(`files/upload: ${JSON.stringify(data?.errors || data?.errorMsg || res.status)}`);
    }
    return id as number;
}

/** Привязывает уже загруженный файл к заказу и задаёт ему имя. */
async function bindFileToOrder(fileId: number, filename: string, orderId: number): Promise<void> {
    const { url: baseUrl, key } = await getCrmConfig();
    const body = new URLSearchParams();
    body.append('file', JSON.stringify({ filename, attachment: [{ order: { id: orderId } }] }));
    const res = await fetch(`${baseUrl}/api/v5/files/${fileId}/edit?apiKey=${key}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
    });
    const data = await res.json().catch(() => ({} as any));
    if (!data?.success) {
        throw new Error(`files/${fileId}/edit: ${JSON.stringify(data?.errors || data?.errorMsg || res.status)}`);
    }
}

/**
 * Прикрепляет вложения письма к заказу RetailCRM. Best-effort: ошибка на отдельном файле
 * не прерывает остальные и НЕ роняет создание заказа — возвращаем счётчики/ошибки для лога.
 */
export async function attachEmailFilesToOrder(
    orderId: number,
    files: EmailFile[]
): Promise<{ attached: number; total: number; skipped: number; errors: string[] }> {
    let attached = 0;
    let skipped = 0;
    const errors: string[] = [];
    for (let i = 0; i < files.length; i++) {
        const f = files[i];
        const content = f?.content;
        if (!content || !content.length) { skipped++; continue; }
        if (content.length > MAX_FILE_BYTES) {
            skipped++;
            errors.push(`${f.filename || `файл_${i + 1}`}: >20МБ — пропущен`);
            continue;
        }
        const filename = (f.filename && f.filename.trim()) || `attachment_${i + 1}`;
        try {
            const id = await uploadFile(content, f.contentType || 'application/octet-stream');
            await bindFileToOrder(id, filename, orderId);
            attached++;
        } catch (e: any) {
            errors.push(`${filename}: ${e?.message || e}`);
        }
    }
    return { attached, total: files.length, skipped, errors };
}
