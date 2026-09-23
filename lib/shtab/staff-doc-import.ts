import { supabase } from '@/utils/supabase';
import { extractTextFromBuffer } from '@/lib/email/attachment-parser';
import { DOC_BUCKET, POST_COLUMNS } from '@/lib/shtab/structure';
import type { StructurePost } from '@/lib/shtab/structure';
import { tsehStaffDocBody } from '@/lib/shtab/tseh-staff';

// Перенос документа сотрудника из ЦехУспеха в папку поста.
//
// Копируем, а не ссылаемся: файл в ЦехУспехе лежит в BLOB внутри чужой базы,
// и читать его на каждый вопрос Тамары — это тянуть мегабайты из боевой базы
// завода. Копия лежит у нас, текст извлечён один раз, источник помечен.

export async function importStaffDoc(docId: string, postRef: unknown): Promise<Record<string, unknown>> {
    if (!docId.trim()) return { available: false, reason: 'Не назван номер документа.' };

    const { data: posts, error: postsError } = await supabase.from('shtab_post').select(POST_COLUMNS);
    if (postsError) return { available: false, reason: postsError.message };

    const all = (posts ?? []) as StructurePost[];
    const needle = String(postRef ?? '').trim().toLowerCase();
    const post =
        /^\d+$/.test(needle)
            ? all.find((p) => p.id === Number(needle))
            : all.find((p) => p.title.trim().toLowerCase() === needle) ??
              all.find((p) => p.title.trim().toLowerCase().includes(needle));
    if (!post) return { available: false, reason: `Поста «${postRef}» нет в структуре.` };

    // Повторный импорт того же документа не плодит копии: диктовка часто
    // повторяется, и вторая копия инструкции в папке — мусор.
    const { data: already } = await supabase
        .from('shtab_post_doc')
        .select('id, post_id')
        .eq('source', 'tseh')
        .eq('external_id', String(docId))
        .maybeSingle();
    if (already) {
        return { imported: false, reason: 'Этот документ уже перенесён', doc_id: already.id, post_id: already.post_id };
    }

    let file: Awaited<ReturnType<typeof tsehStaffDocBody>> = null;
    try {
        file = await tsehStaffDocBody(docId);
    } catch (e: any) {
        return { available: false, reason: `ЦехУспех не отдал файл: ${e.message}` };
    }
    if (!file) return { available: false, reason: 'Такого документа в ЦехУспехе нет или он пустой.' };

    const ext = file.file_name.includes('.') ? `.${file.file_name.split('.').pop()!.toLowerCase()}` : '';
    const storagePath = `post-${post.id}/tseh-${docId}-${Date.now()}${ext}`;

    await supabase.storage.createBucket(DOC_BUCKET, { public: false }).catch(() => undefined);
    const { error: upError } = await supabase.storage
        .from(DOC_BUCKET)
        .upload(storagePath, file.buffer, { contentType: 'application/octet-stream', upsert: false });
    if (upError) return { available: false, reason: `Файл не сохранился: ${upError.message}` };

    let text = '';
    try {
        text = await extractTextFromBuffer(file.buffer, file.file_name);
    } catch {
        text = '';
    }

    const { data, error } = await supabase
        .from('shtab_post_doc')
        .insert({
            post_id: post.id,
            title: file.file_name,
            file_name: file.file_name,
            content_type: '',
            size_bytes: file.buffer.length,
            storage_bucket: DOC_BUCKET,
            storage_path: storagePath,
            text_content: text.slice(0, 200_000),
            source: 'tseh',
            external_id: String(docId),
        })
        .select('id')
        .single();
    if (error) return { available: false, reason: error.message };

    return {
        imported: true,
        doc_id: data.id,
        post: post.title,
        file_name: file.file_name,
        // Текст не извлёкся — почти наверняка скан. Молчать нельзя: иначе выйдет,
        // что документ прочитан и в нём пусто.
        readable: Boolean(text.trim()),
        note: text.trim() ? undefined : 'Текст из файла не извлёкся — похоже на скан. Прочитать его нечем.',
    };
}
