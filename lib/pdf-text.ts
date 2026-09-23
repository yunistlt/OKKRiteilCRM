// Текст из PDF.
//
// Отдельный файл, потому что API pdf-parse сменился на втором мажоре: раньше
// модуль был функцией, теперь экспортирует класс PDFParse. Код, написанный под
// старое API (`const pdfParse = mod.default || mod; await pdfParse(buffer)`),
// не падает на импорте — он падает на вызове, и падение ловится общим catch:
// текст молча получается пустым. Именно так и вышло — PDF-вложения перестали
// читаться незаметно.
//
// Здесь один правильный вызов на весь проект, чтобы этой ошибке негде было
// повториться.

export async function extractPdfText(buffer: Buffer): Promise<string> {
    const mod: any = await import('pdf-parse');
    const PDFParse = mod.PDFParse ?? mod.default?.PDFParse;
    if (!PDFParse) throw new Error('pdf-parse: не найден класс PDFParse');

    const parser = new PDFParse({ data: new Uint8Array(buffer) });
    try {
        const result = await parser.getText();
        return result?.text ?? '';
    } finally {
        await parser.destroy?.().catch(() => undefined);
    }
}
