import { supabase } from '@/utils/supabase';

// Структура компании: посты, кто кому подчинён, что у поста в папке.
//
// Блок схемы — это пост (public.shtab_post). Отдельного справочника блоков нет:
// он разъехался бы с постами, а пост и так знает своё образцовое положение дел,
// статистику и держателя.

export const POST_COLUMNS =
    'id, title, area_code, ideal_scene, statistic, holder_name, external_uid, ordinal, parent_id, pos_x, pos_y, vkp, duties';

export const DOC_BUCKET = 'shtab-docs';

export type StructurePost = {
    id: number;
    title: string;
    area_code: string | null;
    ideal_scene: string;
    statistic: string;
    holder_name: string;
    external_uid: string | null;
    ordinal: number;
    parent_id: number | null;
    pos_x: number;
    pos_y: number;
    vkp: string;
    duties: string;
};

export type StructureDoc = {
    id: number;
    post_id: number;
    title: string;
    file_name: string;
    content_type: string;
    size_bytes: number;
    storage_path: string;
    /** Пусто — текст извлечь не удалось; в интерфейсе это видно. */
    has_text: boolean;
    created_at: string;
};

export async function loadStructure(): Promise<{ posts: StructurePost[]; docs: StructureDoc[] }> {
    const [postsRes, docsRes] = await Promise.all([
        supabase.from('shtab_post').select(POST_COLUMNS).order('ordinal').order('id'),
        supabase
            .from('shtab_post_doc')
            .select('id, post_id, title, file_name, content_type, size_bytes, storage_path, text_content, created_at')
            .order('created_at', { ascending: false }),
    ]);
    if (postsRes.error) throw new Error(postsRes.error.message);
    if (docsRes.error) throw new Error(docsRes.error.message);

    const docs = (docsRes.data ?? []).map((d: any) => ({
        id: d.id,
        post_id: d.post_id,
        title: d.title,
        file_name: d.file_name,
        content_type: d.content_type,
        size_bytes: d.size_bytes,
        storage_path: d.storage_path,
        has_text: Boolean((d.text_content ?? '').trim()),
        created_at: d.created_at,
    }));

    return { posts: (postsRes.data ?? []) as StructurePost[], docs };
}

/**
 * Не заведёт ли такое подчинение кольцо.
 *
 * В базе стоит триггер, который этого не допустит в любом случае; здесь то же
 * самое считается заранее, чтобы владелец увидел человеческую фразу, а не
 * текст исключения Postgres.
 */
export function makesCycle(posts: Array<{ id: number; parent_id: number | null }>, id: number, parentId: number | null): boolean {
    if (parentId === null) return false;
    if (parentId === id) return true;
    const byId = new Map(posts.map((p) => [p.id, p.parent_id]));
    let cur: number | null | undefined = parentId;
    for (let hops = 0; cur != null && hops <= posts.length + 1; hops += 1) {
        if (cur === id) return true;
        cur = byId.get(cur) ?? null;
    }
    return false;
}

/**
 * Структура текстом — в таком виде её читает Тамара.
 *
 * Дерево печатается отступами, а не JSON-ом: подчинение так видно с одного
 * взгляда, и модель реже путает, кто под кем.
 */
export function formatStructure(
    posts: StructurePost[],
    docs: Array<{ post_id: number; title: string }>,
): string {
    if (posts.length === 0) return 'Структура ещё не заведена: постов нет.';

    const children = new Map<number | null, StructurePost[]>();
    for (const p of posts) {
        const key = p.parent_id ?? null;
        if (!children.has(key)) children.set(key, []);
        children.get(key)!.push(p);
    }
    const docsByPost = new Map<number, string[]>();
    for (const d of docs) {
        if (!docsByPost.has(d.post_id)) docsByPost.set(d.post_id, []);
        docsByPost.get(d.post_id)!.push(d.title);
    }

    const lines: string[] = [];
    const seen = new Set<number>();
    const walk = (parent: number | null, depth: number) => {
        for (const p of children.get(parent) ?? []) {
            // Защита от кольца на чтении: триггер его не пустит, но структура
            // могла быть записана в обход — обход не должен зацикливаться.
            if (seen.has(p.id)) continue;
            seen.add(p.id);
            const pad = '  '.repeat(depth);
            const parts = [`${pad}— ${p.title} [id ${p.id}]`];
            if (p.holder_name) parts.push(`${pad}  держит: ${p.holder_name}`);
            if (p.vkp) parts.push(`${pad}  ЦКП: ${p.vkp}`);
            if (p.statistic) parts.push(`${pad}  статистика: ${p.statistic}`);
            if (p.duties) parts.push(`${pad}  обязанности: ${p.duties}`);
            const dl = docsByPost.get(p.id);
            if (dl?.length) parts.push(`${pad}  документы: ${dl.join('; ')}`);
            lines.push(parts.join('\n'));
            walk(p.id, depth + 1);
        }
    };
    walk(null, 0);

    // Посты, до которых обход не дошёл: их родитель потерялся. Молча прятать их
    // нельзя — владелец должен увидеть, что схема порвана.
    const orphans = posts.filter((p) => !seen.has(p.id));
    for (const p of orphans) lines.push(`— ${p.title} [id ${p.id}] (подчинение потеряно)`);

    return lines.join('\n');
}
