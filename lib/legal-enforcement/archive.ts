// Распаковка архива с документами производства.
//
// Человек получает от приставов пачку файлов и грузит её архивом — так и должно
// быть. Архив раскладывается на обычные документы карточки: каждый файл кладётся
// в хранилище рядом и дальше живёт своей строкой, с собственным сырым текстом и
// доказательствами. Сам архив остаётся как есть — из него ничего не извлекаем.
import { supabase } from '@/utils/supabase';
import { unpackArchive } from '@/lib/archive/unpack';
import { ENFORCEMENT_ARCHIVE_ENTRY_RE, ENFORCEMENT_BUCKET, sanitizeEnforcementFileName } from './types';

const MAX_ENTRIES = 50;
const MAX_ENTRY_BYTES = 25 * 1024 * 1024;

function contentTypeByName(name: string): string {
  const lower = name.toLowerCase();
  if (lower.endsWith('.pdf')) return 'application/pdf';
  if (lower.endsWith('.docx')) return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  if (lower.endsWith('.doc')) return 'application/msword';
  if (lower.endsWith('.txt')) return 'text/plain';
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.webp')) return 'image/webp';
  if (/\.tiff?$/.test(lower)) return 'image/tiff';
  return 'image/jpeg';
}

export type UnpackResult = {
  created: number;
  skipped: string[];
};

export async function unpackArchiveDocument(params: {
  caseId: number;
  documentId: number;
  bucket: string;
  storagePath: string;
  uploadedBy?: string | null;
}): Promise<UnpackResult> {
  const { data, error } = await supabase.storage.from(params.bucket).download(params.storagePath);
  if (error) throw error;

  const archiveBuffer = Buffer.from(await data.arrayBuffer());
  const entries = await unpackArchive(archiveBuffer, params.storagePath, (name) =>
    ENFORCEMENT_ARCHIVE_ENTRY_RE.test(name));

  const skipped: string[] = [];
  let created = 0;

  for (const entry of entries) {
    if (created >= MAX_ENTRIES) {
      skipped.push(`в архиве больше ${MAX_ENTRIES} файлов — остальные не разбирались`);
      break;
    }

    const entryName = entry.name;
    const buffer = entry.data;
    if (buffer.length === 0 || buffer.length > MAX_ENTRY_BYTES) {
      skipped.push(`${entryName}: пустой или больше 25 МБ`);
      continue;
    }

    const contentType = contentTypeByName(entryName);
    const path = `${params.caseId}/${Date.now()}_${sanitizeEnforcementFileName(entryName)}`;

    const { error: uploadError } = await supabase.storage
      .from(ENFORCEMENT_BUCKET)
      .upload(path, buffer, { contentType, upsert: false });
    if (uploadError) {
      skipped.push(`${entryName}: не удалось сохранить — ${uploadError.message}`);
      continue;
    }

    const { error: insertError } = await supabase.from('legal_enforcement_documents').insert({
      case_id: params.caseId,
      title: entryName,
      file_name: entryName,
      storage_bucket: ENFORCEMENT_BUCKET,
      storage_path: path,
      content_type: contentType,
      file_size_bytes: buffer.length,
      upload_status: 'uploaded',
      // Файл из архива уже прошёл проверку вместе с архивом.
      scan_status: 'clean',
      extract_status: 'queued',
      uploaded_by: params.uploadedBy || null,
    });
    if (insertError) {
      skipped.push(`${entryName}: не удалось записать — ${insertError.message}`);
      continue;
    }

    created++;
  }

  await supabase
    .from('legal_enforcement_documents')
    .update({
      doc_kind: 'other',
      extract_status: 'completed',
      extract_warnings: {
        archive: `Архив распакован: файлов ${created}`,
        skipped: skipped.length > 0 ? skipped : undefined,
      },
      raw_text: null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', params.documentId);

  return { created, skipped };
}
