/**
 * Печать и подпись юрлица — картинками.
 *
 * Решение владельца 02.10.2026: рисованная печать получилась плохо, на счёт
 * надо ставить настоящие оттиски (те же, что в печатных формах RetailCRM) и
 * его подпись. RetailCRM их через API не отдаёт, поэтому файлы загружает
 * человек — по одному разу на юрлицо.
 *
 * Храним в существующем бакете `okk-assets`, путь — в `legal_entities`.
 */
import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { supabase } from '@/utils/supabase';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const BUCKET = 'okk-assets';
const MAX_BYTES = 4 * 1024 * 1024;
const KINDS = { seal: 'seal_image_path', signature: 'signature_image_path' } as const;

export async function POST(request: Request) {
    const session = await getSession();
    if (!session?.user) return NextResponse.json({ error: 'Неавторизован' }, { status: 401 });

    let form: FormData;
    try {
        form = await request.formData();
    } catch {
        return NextResponse.json({ error: 'Файл не получен' }, { status: 400 });
    }

    const entityId = Number(form.get('entityId'));
    const kind = String(form.get('kind') ?? '') as keyof typeof KINDS;
    const file = form.get('file');

    if (!Number.isFinite(entityId) || !KINDS[kind]) {
        return NextResponse.json({ error: 'Непонятно, для какого юрлица и что загружаем' }, { status: 400 });
    }
    if (!(file instanceof File) || !file.size) {
        return NextResponse.json({ error: 'Выберите картинку' }, { status: 400 });
    }
    if (!/^image\/(png|jpeg|jpg|webp)$/i.test(file.type)) {
        return NextResponse.json({ error: 'Нужна картинка: PNG, JPEG или WebP' }, { status: 415 });
    }
    if (file.size > MAX_BYTES) {
        return NextResponse.json({ error: 'Картинка больше 4 МБ' }, { status: 413 });
    }

    const { data: entity } = await supabase
        .from('legal_entities')
        .select('id, inn, short_name')
        .eq('id', entityId)
        .maybeSingle();
    if (!entity) return NextResponse.json({ error: 'Юрлицо не найдено' }, { status: 404 });

    const extension = file.type.includes('png') ? 'png' : file.type.includes('webp') ? 'webp' : 'jpg';
    const path = `legal-entities/${(entity as any).inn}/${kind}.${extension}`;

    const upload = await supabase.storage.from(BUCKET).upload(path, new Uint8Array(await file.arrayBuffer()), {
        contentType: file.type,
        upsert: true,
    });
    if (upload.error) {
        return NextResponse.json({ error: `Не удалось сохранить: ${upload.error.message}` }, { status: 502 });
    }

    const { error } = await supabase
        .from('legal_entities')
        .update({ [KINDS[kind]]: path })
        .eq('id', entityId);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    return NextResponse.json({ ok: true, path });
}

/** Убрать картинку: печать перерисовали или подпись сменилась. */
export async function DELETE(request: Request) {
    const session = await getSession();
    if (!session?.user) return NextResponse.json({ error: 'Неавторизован' }, { status: 401 });

    const url = new URL(request.url);
    const entityId = Number(url.searchParams.get('entityId'));
    const kind = String(url.searchParams.get('kind') ?? '') as keyof typeof KINDS;

    if (!Number.isFinite(entityId) || !KINDS[kind]) {
        return NextResponse.json({ error: 'Непонятно, что убрать' }, { status: 400 });
    }

    const { data: entity } = await supabase
        .from('legal_entities')
        .select(`id, ${KINDS[kind]}`)
        .eq('id', entityId)
        .maybeSingle();

    const path = (entity as any)?.[KINDS[kind]];
    if (path) await supabase.storage.from(BUCKET).remove([path]);

    const { error } = await supabase
        .from('legal_entities')
        .update({ [KINDS[kind]]: null })
        .eq('id', entityId);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    return NextResponse.json({ ok: true });
}

/** Картинка для показа в настройках: бакет приватных ссылок не раздаёт. */
export async function GET(request: Request) {
    const session = await getSession();
    if (!session?.user) return NextResponse.json({ error: 'Неавторизован' }, { status: 401 });

    const url = new URL(request.url);
    const path = url.searchParams.get('path') || '';
    if (!path.startsWith('legal-entities/')) {
        return NextResponse.json({ error: 'Путь не из этого раздела' }, { status: 400 });
    }

    const file = await supabase.storage.from(BUCKET).download(path);
    if (!file.data) return NextResponse.json({ error: 'Картинка не найдена' }, { status: 404 });

    const buffer = Buffer.from(await file.data.arrayBuffer());
    return new NextResponse(new Uint8Array(buffer), {
        headers: {
            'Content-Type': file.data.type || 'image/png',
            'Cache-Control': 'private, max-age=60',
        },
    });
}
