/**
 * Реквизиты из присланной карточки предприятия.
 *
 * Принимаем PDF, картинку скана и текстовый файл. У PDF сначала пробуем взять
 * текстовый слой — он точный; если его нет (скан), распознаём картинку.
 */
import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { parseRequisitesFromText } from '@/lib/own-crm/requisites-lookup';
import { extractTextFromImageBuffer } from '@/lib/legal-ocr';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

/** Текст из файла: сначала простое, потом тяжёлое. */
async function readText(buffer: Buffer, type: string, name: string): Promise<string> {
    const isPdf = type.includes('pdf') || name.toLowerCase().endsWith('.pdf');

    if (isPdf) {
        try {
            const { PDFParse } = await import('pdf-parse');
            const parsed = await new PDFParse({ data: new Uint8Array(buffer) }).getText();
            const text = String(parsed?.text ?? '').trim();
            // В сканах текстового слоя нет — там пусто, идём распознавать.
            if (text.length > 40) return text;
        } catch {
            // Не прочитался как PDF — попробуем как картинку.
        }
    }

    if (type.startsWith('image/') || isPdf) {
        return await extractTextFromImageBuffer(buffer);
    }

    return buffer.toString('utf8');
}

export async function POST(request: Request) {
    const session = await getSession();
    if (!session?.user) return NextResponse.json({ error: 'Неавторизован' }, { status: 401 });

    const form = await request.formData().catch(() => null);
    const file = form?.get('file');

    if (!(file instanceof File)) {
        return NextResponse.json({ error: 'Приложите файл карточки предприятия' }, { status: 400 });
    }
    if (file.size > 15 * 1024 * 1024) {
        return NextResponse.json({ error: 'Файл больше 15 МБ — пришлите карточку поменьше' }, { status: 400 });
    }

    try {
        const buffer = Buffer.from(await file.arrayBuffer());
        const text = await readText(buffer, file.type || '', file.name || '');
        const requisites = parseRequisitesFromText(text);

        const filled = Object.values(requisites).filter(Boolean).length;
        if (!filled) {
            return NextResponse.json(
                { error: 'В файле не нашлось реквизитов — проверьте, та ли это карточка' },
                { status: 422 },
            );
        }

        return NextResponse.json({ ok: true, requisites, filled });
    } catch (e: any) {
        console.error('[реквизиты из файла] не разобрался:', e?.message);
        return NextResponse.json({ error: 'Файл не удалось прочитать' }, { status: 500 });
    }
}
