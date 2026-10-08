import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getSession } from '@/lib/auth';
import { supabase } from '@/utils/supabase';
import { entityFiles, putEntityFile } from '@/lib/legal-entity/files';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const MAX_BYTES = 25 * 1024 * 1024;

/**
 * Файлы в карточке клиента.
 *
 * Для НАШЕЙ компании (стоит признак «наше юрлицо») это её документы: устав,
 * ЕГРЮЛ, ИНН, карточка предприятия, отчётность. Их же отдаёт клиенту
 * публичная ссылка /docs/<код>.
 *
 * Решение владельца 08.10.2026: не плодить отдельный раздел — человек ищет
 * документы там, где открыл компанию.
 */
async function ourEntityOf(clientId: string): Promise<{ id: number; slug: string | null } | null> {
    const { data } = await supabase
        .from('clients')
        .select('our_legal_entity_id')
        .eq('id', clientId)
        .maybeSingle();

    const entityId = (data as any)?.our_legal_entity_id;
    if (!entityId) return null;

    const { data: entity } = await supabase
        .from('legal_entities')
        .select('id, public_slug')
        .eq('id', entityId)
        .maybeSingle();

    if (!entity) return null;
    return { id: Number((entity as any).id), slug: (entity as any).public_slug ?? null };
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: 'Неавторизован' }, { status: 401 });

    const { id } = await params;
    const entity = await ourEntityOf(id);

    // Не наше юрлицо — файлов компании нет, и это не ошибка.
    if (!entity) return NextResponse.json({ ok: true, ours: false, files: [], slug: null });

    return NextResponse.json({
        ok: true,
        ours: true,
        slug: entity.slug,
        files: await entityFiles(entity.id),
    });
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: 'Неавторизован' }, { status: 401 });

    const { id } = await params;
    const entity = await ourEntityOf(id);
    if (!entity) return NextResponse.json({ error: 'Это не наше юрлицо — поставьте признак в карточке' }, { status: 409 });
    if (!entity.slug) return NextResponse.json({ error: 'У юрлица нет короткого кода для публичной ссылки' }, { status: 409 });

    const form = await req.formData().catch(() => null);
    const file = form?.get('file');
    if (!(file instanceof File) || !file.size) return NextResponse.json({ error: 'Пустой файл' }, { status: 400 });
    if (file.size > MAX_BYTES) return NextResponse.json({ error: 'Файл тяжелее 25 МБ' }, { status: 413 });

    const saved = await putEntityFile({
        entityId: entity.id,
        slug: entity.slug,
        fileName: file.name,
        folder: String(form?.get('folder') ?? '').trim() || null,
        contentType: file.type || null,
        bytes: new Uint8Array(await file.arrayBuffer()),
        source: 'загружен вручную',
        uploadedBy: session.user.email || session.user.username || null,
    });

    if (!saved.ok) return NextResponse.json({ error: `Не сохранился: ${saved.reason}` }, { status: 500 });
    return NextResponse.json({ ok: true, id: saved.id });
}

const PatchSchema = z.object({
    /** Пометить карточку нашим юрлицом (или снять пометку). */
    ourLegalEntityId: z.number().int().positive().nullable().optional(),
    /** Правка файла: видимость клиенту или удаление. */
    fileId: z.number().int().positive().optional(),
    isPublic: z.boolean().optional(),
    deleted: z.boolean().optional(),
});

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: 'Неавторизован' }, { status: 401 });

    const { id } = await params;
    const parsed = PatchSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: 'Непонятное действие' }, { status: 400 });

    if (parsed.data.ourLegalEntityId !== undefined) {
        const { error } = await supabase
            .from('clients')
            .update({ our_legal_entity_id: parsed.data.ourLegalEntityId, updated_at: new Date().toISOString() })
            .eq('id', id);
        if (error) return NextResponse.json({ error: error.message }, { status: 500 });
        return NextResponse.json({ ok: true });
    }

    if (!parsed.data.fileId) return NextResponse.json({ error: 'Не указан файл' }, { status: 400 });

    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (parsed.data.isPublic !== undefined) patch.is_public = parsed.data.isPublic;
    // Удаление мягкое: из списков пропадёт, файл в хранилище останется.
    if (parsed.data.deleted !== undefined) patch.deleted_at = parsed.data.deleted ? new Date().toISOString() : null;

    const { error } = await supabase.from('legal_entity_files').update(patch).eq('id', parsed.data.fileId);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    return NextResponse.json({ ok: true });
}
