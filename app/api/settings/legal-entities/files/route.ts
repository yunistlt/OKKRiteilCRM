import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getSession } from '@/lib/auth';
import { hasAnyRole } from '@/lib/rbac';
import { supabase } from '@/utils/supabase';
import { entityFiles, putEntityFile } from '@/lib/legal-entity/files';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const MAX_BYTES = 25 * 1024 * 1024;

/** Документы юрлица: список, загрузка, видимость для клиента, удаление. */
export async function GET(req: Request) {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: 'Неавторизован' }, { status: 401 });

    const entityId = Number(new URL(req.url).searchParams.get('entityId'));
    if (!Number.isFinite(entityId)) return NextResponse.json({ error: 'Не указано юрлицо' }, { status: 400 });

    const { data: entity } = await supabase
        .from('legal_entities')
        .select('public_slug, short_name')
        .eq('id', entityId)
        .maybeSingle();

    return NextResponse.json({
        ok: true,
        slug: (entity as any)?.public_slug ?? null,
        files: await entityFiles(entityId),
    });
}

export async function POST(req: Request) {
    const session = await getSession();
    // Уставные документы компании — не то, что правит менеджер.
    if (!hasAnyRole(session, ['admin', 'jurist', 'buhgalter'])) {
        return NextResponse.json({ error: 'Доступ запрещён' }, { status: 403 });
    }

    const form = await req.formData().catch(() => null);
    if (!form) return NextResponse.json({ error: 'Файл не получен' }, { status: 400 });

    const entityId = Number(form.get('entityId'));
    const file = form.get('file');
    const folder = String(form.get('folder') ?? '').trim() || null;

    if (!Number.isFinite(entityId)) return NextResponse.json({ error: 'Не указано юрлицо' }, { status: 400 });
    if (!(file instanceof File) || !file.size) return NextResponse.json({ error: 'Пустой файл' }, { status: 400 });
    if (file.size > MAX_BYTES) return NextResponse.json({ error: 'Файл тяжелее 25 МБ' }, { status: 413 });

    const { data: entity } = await supabase
        .from('legal_entities')
        .select('public_slug')
        .eq('id', entityId)
        .maybeSingle();

    const slug = (entity as any)?.public_slug;
    if (!slug) {
        return NextResponse.json(
            { error: 'У юрлица нет короткого кода для публичной ссылки — задайте его в карточке' },
            { status: 409 },
        );
    }

    const saved = await putEntityFile({
        entityId,
        slug,
        fileName: file.name,
        folder,
        contentType: file.type || null,
        bytes: new Uint8Array(await file.arrayBuffer()),
        source: 'загружен вручную',
        uploadedBy: session!.user.email || session!.user.username || null,
    });

    if (!saved.ok) return NextResponse.json({ error: `Не сохранился: ${saved.reason}` }, { status: 500 });
    return NextResponse.json({ ok: true, id: saved.id });
}

const PatchSchema = z.object({
    id: z.number().int().positive(),
    isPublic: z.boolean().optional(),
    deleted: z.boolean().optional(),
});

export async function PATCH(req: Request) {
    const session = await getSession();
    if (!hasAnyRole(session, ['admin', 'jurist', 'buhgalter'])) {
        return NextResponse.json({ error: 'Доступ запрещён' }, { status: 403 });
    }

    const parsed = PatchSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: 'Непонятное действие' }, { status: 400 });

    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (parsed.data.isPublic !== undefined) patch.is_public = parsed.data.isPublic;
    // Удаление мягкое: документ пропадает из списков, файл остаётся в хранилище.
    if (parsed.data.deleted !== undefined) patch.deleted_at = parsed.data.deleted ? new Date().toISOString() : null;

    const { error } = await supabase.from('legal_entity_files').update(patch).eq('id', parsed.data.id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    return NextResponse.json({ ok: true });
}
