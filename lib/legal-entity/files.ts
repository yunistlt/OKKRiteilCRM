import { supabase } from '@/utils/supabase';

/**
 * Документы нашего юрлица: устав, ЕГРЮЛ, ИНН, карточка предприятия.
 *
 * Раньше менеджер слал клиенту ссылку на Яндекс.Диск. Чужое хранилище:
 * доступ не наш, срок жизни ссылки не наш, состав папки не виден из системы.
 * Теперь файлы лежат у нас, а клиент получает ссылку на наш сайт
 * (требование владельца 08.10.2026).
 */

export const BUCKET = 'okk-assets';

export type EntityFile = {
    id: number;
    fileName: string;
    folder: string | null;
    contentType: string | null;
    size: number | null;
    isPublic: boolean;
    storagePath: string;
};

/** Безопасный кусок пути: кириллица в именах файлов хранилище не принимает. */
export function safeName(name: string): string {
    const translit: Record<string, string> = {
        а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i',
        й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't',
        у: 'u', ф: 'f', х: 'h', ц: 'c', ч: 'ch', ш: 'sh', щ: 'sch', ъ: '', ы: 'y', ь: '',
        э: 'e', ю: 'yu', я: 'ya',
    };

    const lower = String(name ?? '').toLowerCase();
    let out = '';
    for (const ch of lower) {
        if (translit[ch] !== undefined) out += translit[ch];
        else if (/[a-z0-9._-]/.test(ch)) out += ch;
        else out += '-';
    }
    return out.replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 120) || 'file';
}

/** Документы юрлица. `onlyPublic` — то, что показываем клиенту по ссылке. */
export async function entityFiles(entityId: number, onlyPublic = false): Promise<EntityFile[]> {
    let query = supabase
        .from('legal_entity_files')
        .select('id, file_name, folder, content_type, size_bytes, is_public, storage_path')
        .eq('entity_id', entityId)
        .is('deleted_at', null)
        .order('sort_order')
        .order('folder', { nullsFirst: true })
        .order('file_name');

    if (onlyPublic) query = query.eq('is_public', true);

    const { data, error } = await query;
    if (error) {
        console.error('[legal-files] список не прочитался:', error.message);
        return [];
    }

    return ((data ?? []) as any[]).map((row) => ({
        id: Number(row.id),
        fileName: String(row.file_name),
        folder: row.folder ?? null,
        contentType: row.content_type ?? null,
        size: row.size_bytes === null ? null : Number(row.size_bytes),
        isPublic: Boolean(row.is_public),
        storagePath: String(row.storage_path),
    }));
}

/** Юрлицо по короткому коду из публичной ссылки (/docs/zmk). */
export async function entityBySlug(slug: string): Promise<{ id: number; name: string; inn: string | null } | null> {
    const { data } = await supabase
        .from('legal_entities')
        .select('id, short_name, full_name, inn')
        .eq('public_slug', String(slug ?? '').trim().toLowerCase())
        .maybeSingle();

    const row = data as any;
    if (!row) return null;
    return { id: Number(row.id), name: row.short_name || row.full_name || 'Наша компания', inn: row.inn ?? null };
}

/** Положить файл в хранилище и записать в список документов юрлица. */
export async function putEntityFile(params: {
    entityId: number;
    slug: string;
    fileName: string;
    folder?: string | null;
    contentType?: string | null;
    bytes: Uint8Array;
    source?: string | null;
    uploadedBy?: string | null;
    isPublic?: boolean;
}): Promise<{ ok: true; id: number } | { ok: false; reason: string }> {
    const folderPart = params.folder ? `${safeName(params.folder)}/` : '';
    const path = `legal-entities/${safeName(params.slug)}/docs/${folderPart}${safeName(params.fileName)}`;

    const upload = await supabase.storage.from(BUCKET).upload(path, params.bytes, {
        contentType: params.contentType || 'application/octet-stream',
        upsert: true,
    });
    if (upload.error) return { ok: false, reason: upload.error.message };

    const { data, error } = await supabase
        .from('legal_entity_files')
        .upsert({
            entity_id: params.entityId,
            file_name: params.fileName,
            folder: params.folder ?? null,
            content_type: params.contentType ?? null,
            size_bytes: params.bytes.byteLength,
            storage_path: path,
            source: params.source ?? null,
            uploaded_by: params.uploadedBy ?? null,
            is_public: params.isPublic ?? true,
            updated_at: new Date().toISOString(),
            deleted_at: null,
        }, { onConflict: 'entity_id,storage_path' })
        .select('id')
        .single();

    if (error) return { ok: false, reason: error.message };
    return { ok: true, id: Number((data as any).id) };
}
