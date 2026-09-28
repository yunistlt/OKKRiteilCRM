// Распаковка архивов: ZIP и RAR.
//
// Документы от приставов, бухгалтерии и контрагентов приходят архивом — это
// нормальный способ прислать пачку. Заставлять человека доставать файлы по
// одному значит, что он просто не будет их присылать.
//
// ZIP — adm-zip (чистый JS). RAR — node-unrar-js (WebAssembly, работает и в
// serverless, где никаких распаковщиков в системе нет). 7z и tar не поддержаны:
// честнее сказать это прямо, чем вернуть пустоту, похожую на пустой архив.
import AdmZip from 'adm-zip';

export type ArchiveEntry = {
  name: string;
  data: Buffer;
};

export type ArchiveKind = 'zip' | 'rar' | 'unsupported' | 'none';

const ZIP_MAGIC = Buffer.from([0x50, 0x4b]); // PK
const RAR_MAGIC = Buffer.from('Rar!', 'ascii');
const SEVEN_Z_MAGIC = Buffer.from([0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c]);

/**
 * Что за архив. Смотрим и на имя, и на сигнатуру: браузер часто отдаёт
 * архив как application/octet-stream, а имя бывает без расширения.
 */
export function detectArchiveKind(buffer: Buffer | null | undefined, fileName?: string | null): ArchiveKind {
  const lower = String(fileName || '').toLowerCase();

  if (buffer && buffer.length >= 6) {
    if (buffer.subarray(0, 2).equals(ZIP_MAGIC)) {
      // docx/xlsx — тоже zip внутри; их разбирают своими парсерами, не как архив.
      if (/\.(docx|xlsx|xlsm|pptx|odt|ods)$/i.test(lower)) return 'none';
      return 'zip';
    }
    if (buffer.subarray(0, 4).equals(RAR_MAGIC)) return 'rar';
    if (buffer.subarray(0, 6).equals(SEVEN_Z_MAGIC)) return 'unsupported';
  }

  if (/\.zip$/i.test(lower)) return 'zip';
  if (/\.rar$/i.test(lower)) return 'rar';
  if (/\.(7z|tar|gz|tgz|bz2)$/i.test(lower)) return 'unsupported';

  return 'none';
}

export function isArchiveName(fileName?: string | null) {
  return /\.(zip|rar|7z|tar|gz|tgz|bz2)$/i.test(String(fileName || ''));
}

export class UnsupportedArchiveError extends Error {
  constructor(fileName?: string | null) {
    super(
      `Архив «${fileName || 'без имени'}» в формате 7z/tar не распаковывается. Пересохраните его в ZIP или RAR — эти читаются.`,
    );
    this.name = 'UnsupportedArchiveError';
  }
}

const MAX_ENTRIES = 100;
const MAX_ENTRY_BYTES = 25 * 1024 * 1024;

/**
 * Файлы внутри архива. Папки, служебные записи macOS и пустышки отбрасываем.
 * `filter` — по имени файла, чтобы не распаковывать лишнее в память.
 */
export async function unpackArchive(
  buffer: Buffer,
  fileName?: string | null,
  filter?: (name: string) => boolean,
): Promise<ArchiveEntry[]> {
  const kind = detectArchiveKind(buffer, fileName);
  if (kind === 'unsupported') throw new UnsupportedArchiveError(fileName);
  if (kind === 'none') return [];

  const entries: ArchiveEntry[] = [];

  const accept = (name: string) => {
    const base = name.split('/').pop() || name;
    if (!base || base.startsWith('.') || name.startsWith('__MACOSX/')) return false;
    return filter ? filter(base) : true;
  };

  if (kind === 'zip') {
    const zip = new AdmZip(buffer);
    for (const entry of zip.getEntries()) {
      if (entries.length >= MAX_ENTRIES) break;
      if (entry.isDirectory) continue;
      if (!accept(entry.entryName)) continue;

      const data = entry.getData();
      if (data.length === 0 || data.length > MAX_ENTRY_BYTES) continue;
      entries.push({ name: entry.entryName.split('/').pop() || entry.entryName, data });
    }
    return entries;
  }

  // RAR: распаковщик на WebAssembly, читает из памяти.
  const { createExtractorFromData } = await import('node-unrar-js');
  const extractor = await createExtractorFromData({
    data: buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer,
  });

  const list = extractor.getFileList();
  // Generator → массив через Array.from: spread по генератору наш target не даёт.
  const names = Array.from(list.fileHeaders as any)
    .filter((header: any) => !header.flags?.directory && accept(header.name))
    .map((header: any) => header.name)
    .slice(0, MAX_ENTRIES);
  if (names.length === 0) return [];

  const extracted = extractor.extract({ files: names });
  for (const file of Array.from(extracted.files as any) as any[]) {
    const data = file.extraction ? Buffer.from(file.extraction) : null;
    if (!data || data.length === 0 || data.length > MAX_ENTRY_BYTES) continue;
    entries.push({ name: file.fileHeader.name.split('/').pop() || file.fileHeader.name, data });
  }

  return entries;
}
