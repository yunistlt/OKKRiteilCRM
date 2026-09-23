import { describe, expect, it } from 'vitest';
import { decodeTextBuffer } from '@/lib/text-decode';

const RU = 'Имя;Сумма\nПечь конвейерная;1200\n';

/** windows-1251 без iconv: у кириллицы там простое смещение от Unicode. */
function toWin1251(text: string): Buffer {
    return Buffer.from(
        Array.from(text).map((ch) => {
            const code = ch.charCodeAt(0);
            if (code >= 0x410 && code <= 0x44f) return code - 0x410 + 0xc0;
            if (code === 0x401) return 0xa8;
            if (code === 0x451) return 0xb8;
            return code;
        }),
    );
}

describe('кодировка текстовых файлов', () => {
    it('UTF-8 читается как есть', () => {
        expect(decodeTextBuffer(Buffer.from(RU, 'utf-8'))).toBe(RU);
    });

    it('UTF-8 с BOM отдаётся без BOM', () => {
        // Excel ставит BOM, а невидимый символ в начале ломает первый заголовок.
        const withBom = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(RU, 'utf-8')]);
        expect(decodeTextBuffer(withBom)).toBe(RU);
    });

    it('windows-1251 узнаётся и читается', () => {
        // Иначе выгрузка из 1С превращается в кракозябры, и это не падение —
        // файл выглядит прочитанным.
        expect(decodeTextBuffer(toWin1251(RU))).toBe(RU);
    });

    it('латиница не ломается ни в одной из веток', () => {
        expect(decodeTextBuffer(Buffer.from('name;sum\nbox;10\n', 'utf-8'))).toBe('name;sum\nbox;10\n');
    });
});
