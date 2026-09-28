import AdmZip from 'adm-zip';
import { describe, expect, it } from 'vitest';
import { detectArchiveKind, isArchiveName, unpackArchive, UnsupportedArchiveError } from '@/lib/archive/unpack';
import { extractTextFromBuffer } from '@/lib/email/attachment-parser';

function makeZip(files: Array<[string, string]>) {
  const zip = new AdmZip();
  for (const [name, content] of files) zip.addFile(name, Buffer.from(content, 'utf-8'));
  return zip.toBuffer();
}

describe('распаковка архивов', () => {
  it('узнаёт ZIP по сигнатуре, даже если имя без расширения', () => {
    expect(detectArchiveKind(makeZip([['a.txt', 'текст']]), 'файл_без_расширения')).toBe('zip');
  });

  it('не считает архивом docx и xlsx (внутри они тоже zip)', () => {
    expect(detectArchiveKind(makeZip([['word/document.xml', '<x/>']]), 'договор.docx')).toBe('none');
  });

  it('честно помечает 7z как неподдерживаемый', () => {
    const sevenZ = Buffer.from([0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c, 0x00, 0x00]);
    expect(detectArchiveKind(sevenZ, 'пачка.7z')).toBe('unsupported');
    expect(isArchiveName('пачка.7z')).toBe(true);
  });

  it('достаёт файлы из ZIP и отбрасывает служебные', async () => {
    const buffer = makeZip([
      ['постановление.txt', 'Постановление о возбуждении'],
      ['__MACOSX/._постановление.txt', 'мусор'],
      ['.DS_Store', 'мусор'],
    ]);
    const entries = await unpackArchive(buffer, 'пачка.zip');
    expect(entries.map((entry) => entry.name)).toEqual(['постановление.txt']);
    expect(entries[0].data.toString('utf-8')).toContain('Постановление');
  });

  it('уважает фильтр по типу файла', async () => {
    const buffer = makeZip([
      ['документ.txt', 'текст'],
      ['картинка.bmp', 'не наш формат'],
    ]);
    const entries = await unpackArchive(buffer, 'пачка.zip', (name) => /\.txt$/i.test(name));
    expect(entries.map((entry) => entry.name)).toEqual(['документ.txt']);
  });

  it('бросает понятную ошибку на 7z', async () => {
    const sevenZ = Buffer.from([0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c, 0x00, 0x00]);
    await expect(unpackArchive(sevenZ, 'пачка.7z')).rejects.toBeInstanceOf(UnsupportedArchiveError);
  });
});

describe('вложения: архив читается как пачка документов', () => {
  it('склеивает текст файлов архива с подписями имён', async () => {
    const buffer = makeZip([
      ['постановление.txt', 'Исполнительное производство 12345/26/63001-ИП'],
      ['требование.txt', 'Требование об уплате налога'],
    ]);
    const text = await extractTextFromBuffer(buffer, 'документы.zip');

    expect(text).toContain('файл из архива: постановление.txt');
    expect(text).toContain('12345/26/63001-ИП');
    expect(text).toContain('файл из архива: требование.txt');
    expect(text).toContain('Требование об уплате налога');
  });

  it('про 7z говорит прямо, а не отдаёт пустоту', async () => {
    const sevenZ = Buffer.from([0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c, 0x00, 0x00]);
    const text = await extractTextFromBuffer(sevenZ, 'пачка.7z');
    expect(text).toContain('7z');
    expect(text).not.toBe('');
  });

  it('пустой архив не выдаёт за прочитанный', async () => {
    const text = await extractTextFromBuffer(makeZip([['картинка.bmp', 'x']]), 'пачка.zip');
    expect(text).toContain('нет файлов');
  });
});
