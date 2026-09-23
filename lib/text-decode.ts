// Текстовый файл → строка, с угадыванием кодировки.
//
// Русские CSV приезжают из 1С, Excel и заводских программ в windows-1251 чаще,
// чем в UTF-8. Прочитать такой файл как UTF-8 — это не ошибка чтения, а строка
// из «кракозябр»: разбор не падает, и файл выглядит прочитанным. Поэтому
// кодировка проверяется, а не предполагается.

/** BOM UTF-8. Excel его ставит, и тогда гадать не нужно. */
const BOM = '﻿';

export function decodeTextBuffer(buffer: Buffer): string {
    if (buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) {
        return buffer.toString('utf-8').replace(BOM, '');
    }

    const utf8 = buffer.toString('utf-8');
    // U+FFFD появляется там, где байты не складываются в UTF-8. Одиночный может
    // быть и в настоящем UTF-8 тексте, поэтому смотрим на долю.
    const broken = (utf8.match(/�/g) || []).length;
    if (broken === 0 || broken / Math.max(1, utf8.length) < 0.002) return utf8;

    try {
        return new TextDecoder('windows-1251').decode(buffer);
    } catch {
        return utf8;
    }
}
