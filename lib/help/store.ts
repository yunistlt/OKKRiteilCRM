/**
 * Справка по работе программы.
 *
 * Требование владельца 02.10.2026: как в соседнем проекте
 * (erp.zmksoft.ru/help/...) — страницы помощи по каждой функции; и теми же
 * текстами учим Семёна, чтобы он консультировал по фичам.
 *
 * Поэтому источник один — РАГ-база Семёна `okk_consultant_knowledge`
 * (закон «знания ИИ в РАГ, не в файлах»). Статьи лежат там строками с
 * `type = 'help'`: страницы справки читают их, и тот же текст попадает в
 * ответы консультанта. Новой таблицы не заводим — закон «проверь, что такого
 * ещё нет».
 *
 * Исходники статей — `docs/help/*.md` в репозитории; в базу их переносит
 * `scripts/sync-help.ts` (он же считает эмбеддинги).
 */
import { supabase } from '@/utils/supabase';

export const HELP_TYPE = 'help';

export type HelpArticle = {
    slug: string;
    title: string;
    /** Раздел справки: «Заказы», «Клиенты», «Письма и файлы»… */
    section: string;
    /** Порядок внутри раздела. */
    order: number;
    content: string;
    tags: string[];
    updatedAt: string | null;
};

/** Слаг страницы из слага записи РАГ: `help:orders-card` → `orders-card`. */
export function slugOf(row: any): string {
    return String(row?.slug ?? '').replace(/^help:/, '');
}

function toArticle(row: any): HelpArticle {
    const meta = (row?.metadata ?? {}) as Record<string, any>;
    return {
        slug: slugOf(row),
        title: String(row?.title ?? slugOf(row)),
        section: String(meta.section || row?.section_key || 'Разное'),
        order: Number(meta.order ?? 100),
        content: String(row?.content ?? ''),
        tags: Array.isArray(row?.tags) ? row.tags.map(String) : [],
        updatedAt: row?.updated_at ?? null,
    };
}

/** Все статьи справки, по разделам и порядку. */
export async function listHelpArticles(): Promise<HelpArticle[]> {
    const { data, error } = await supabase
        .from('okk_consultant_knowledge')
        .select('slug, title, content, tags, metadata, section_key, updated_at')
        .eq('type', HELP_TYPE)
        .eq('is_active', true);

    if (error) {
        console.warn('[help] не прочитал справку:', error.message);
        return [];
    }

    return ((data ?? []) as any[])
        .map(toArticle)
        .sort((left, right) =>
            left.section.localeCompare(right.section, 'ru')
            || left.order - right.order
            || left.title.localeCompare(right.title, 'ru'));
}

/** Одна статья по её слагу. */
export async function loadHelpArticle(slug: string): Promise<HelpArticle | null> {
    const key = String(slug ?? '').trim();
    if (!key) return null;

    const { data } = await supabase
        .from('okk_consultant_knowledge')
        .select('slug, title, content, tags, metadata, section_key, updated_at')
        .eq('type', HELP_TYPE)
        .eq('slug', `help:${key}`)
        .maybeSingle();

    return data ? toArticle(data) : null;
}
