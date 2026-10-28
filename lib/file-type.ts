/**
 * Чем является файл — чтобы браузер показывал его, а не скачивал.
 *
 * Браузер решает по заголовку `Content-Type`: с `application/pdf` он откроет
 * документ во вкладке, а с `application/octet-stream` молча положит в
 * «Загрузки», даже когда мы просим `inline`. Именно так вели себя вложения,
 * долитые из RetailCRM (28.10.2026): их тип нам никто не сообщил, и записаны
 * они были «просто байтами».
 *
 * Тип определяем по двум источникам, от надёжного к нему же:
 *   1. первые байты самого файла — подделать расширение можно, сигнатуру нет;
 *      это единственный путь для «Счет ПОБТ» и прочих имён без расширения,
 *      каких в RetailCRM целая пачка;
 *   2. расширение имени — когда байтов под рукой нет.
 */

/** Расширение → тип. Только то, что реально ходит по заказам. */
const BY_EXTENSION: Record<string, string> = {
    pdf: 'application/pdf',
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    webp: 'image/webp',
    bmp: 'image/bmp',
    tif: 'image/tiff',
    tiff: 'image/tiff',
    svg: 'image/svg+xml',
    heic: 'image/heic',
    txt: 'text/plain; charset=utf-8',
    csv: 'text/csv; charset=utf-8',
    html: 'text/html; charset=utf-8',
    xml: 'application/xml',
    json: 'application/json',
    doc: 'application/msword',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    xls: 'application/vnd.ms-excel',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    ppt: 'application/vnd.ms-powerpoint',
    pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    rtf: 'application/rtf',
    zip: 'application/zip',
    rar: 'application/vnd.rar',
    '7z': 'application/x-7z-compressed',
    dwg: 'image/vnd.dwg',
    dxf: 'image/vnd.dxf',
    mp4: 'video/mp4',
    mp3: 'audio/mpeg',
    wav: 'audio/wav',
    ogg: 'audio/ogg',
};

/** Сигнатура в начале файла → тип. Проверяется до расширения. */
const BY_SIGNATURE: Array<{ type: string; magic: number[] }> = [
    { type: 'application/pdf', magic: [0x25, 0x50, 0x44, 0x46] },                    // %PDF
    { type: 'image/png', magic: [0x89, 0x50, 0x4e, 0x47] },                          // ‰PNG
    { type: 'image/jpeg', magic: [0xff, 0xd8, 0xff] },
    { type: 'image/gif', magic: [0x47, 0x49, 0x46, 0x38] },                          // GIF8
    { type: 'image/tiff', magic: [0x49, 0x49, 0x2a, 0x00] },
    { type: 'image/tiff', magic: [0x4d, 0x4d, 0x00, 0x2a] },
    { type: 'application/rtf', magic: [0x7b, 0x5c, 0x72, 0x74, 0x66] },              // {\rtf
    // Старый формат Office (.doc, .xls, .ppt) — общий контейнер OLE2.
    { type: 'application/msword', magic: [0xd0, 0xcf, 0x11, 0xe0] },
];

/** Тип по первым байтам. null — сигнатура незнакомая. */
function bySignature(bytes: Uint8Array): string | null {
    for (const { type, magic } of BY_SIGNATURE) {
        if (magic.every((byte, i) => bytes[i] === byte)) return type;
    }

    /**
     * ZIP-контейнер: под ним и обычный архив, и docx/xlsx/pptx. Отличить их
     * можно только по имени первой записи, поэтому здесь не решаем — пусть
     * скажет расширение.
     */
    return null;
}

/** Тип по расширению имени. null — расширения нет или оно незнакомое. */
function byExtension(fileName: string): string | null {
    const extension = /\.([a-z0-9]{1,5})$/i.exec(String(fileName ?? '').trim());
    if (!extension) return null;

    return BY_EXTENSION[extension[1].toLowerCase()] ?? null;
}

/**
 * Чем отдавать файл браузеру.
 *
 * `bytes` — начало файла, хватит первых восьми; без них смотрим только имя.
 * `fallback` задаёт ответ, когда не узнали ничего: по умолчанию «просто
 * байты», то есть скачивание.
 */
export function fileContentType(
    fileName: string,
    bytes?: Uint8Array | null,
    fallback = 'application/octet-stream',
): string {
    if (bytes && bytes.length >= 4) {
        const signature = bySignature(bytes);
        // Документ Office нового формата лежит в ZIP, а старый — в OLE2, и по
        // сигнатуре docx от xlsx не отличить: имя здесь точнее.
        if (signature && signature !== 'application/msword') return signature;

        const named = byExtension(fileName);
        if (named) return named;
        if (signature) return signature;

        return fallback;
    }

    return byExtension(fileName) ?? fallback;
}

/** Можно ли показать такой файл прямо во вкладке, не скачивая. */
export function isViewableInBrowser(contentType: string): boolean {
    const type = String(contentType ?? '').toLowerCase();

    return type.startsWith('image/')
        || type.startsWith('text/')
        || type.startsWith('audio/')
        || type.startsWith('video/')
        || type === 'application/pdf';
}

/**
 * Короткая метка типа для списка файлов: PDF, JPG, DOC.
 *
 * В RetailCRM у каждой строки стоит значок формата, и человек с одного взгляда
 * отличает счёт от фотографии. Берём расширение имени, а когда его нет (в
 * RetailCRM таких вложений целая пачка) — выводим из типа.
 */
export function fileKindLabel(fileName: string, contentType?: string | null): string {
    const extension = /\.([a-z0-9]{1,5})$/i.exec(String(fileName ?? '').trim());
    if (extension) return extension[1].toUpperCase();

    const type = String(contentType ?? '').toLowerCase();
    if (type === 'application/pdf') return 'PDF';
    if (type === 'application/msword') return 'DOC';
    if (type.startsWith('image/')) return type.slice(6, 10).toUpperCase();
    if (type.startsWith('text/')) return 'TXT';

    return 'ФАЙЛ';
}
