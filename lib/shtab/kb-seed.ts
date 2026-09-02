import { createHash } from 'node:crypto';
import type { Sql } from 'postgres';
import { SHTAB_KB_SEED, formatShtabKbForEmbedding } from '@/lib/shtab/kb-content';

// Засев знаний Тамары в shtab_kb.
//
// Логика лежит здесь, а не в scripts/, по одной причине: её надо проверять.
// Папка scripts/ исключена из tsconfig и не покрыта тестами, а тут ошибка стоит
// дорого — повторный засев либо задвоит статьи, либо заново оплатит эмбеддинги.
//
// Считалка эмбеддингов передаётся снаружи: в проде это OpenAI, в проверке —
// подставная, и тогда всю работу с базой можно прогнать на живом Postgres,
// не тратя денег.

export type Embedder = (text: string) => Promise<number[]>;

export type SeedReport = {
    inserted: string[];
    updated: string[];
    unchanged: string[];
    deactivated: string[];
};

/** Отпечаток текста: по нему видно, надо ли пересчитывать эмбеддинг. */
export function kbFingerprint(text: string): string {
    return createHash('sha256').update(text).digest('hex').slice(0, 16);
}

/** Повторяющиеся slug — их не должно быть: ON CONFLICT молча съел бы дубликат. */
export function duplicateSlugs(slugs: readonly string[]): string[] {
    return Array.from(new Set(slugs.filter((s, i) => slugs.indexOf(s) !== i)));
}

export async function seedShtabKb(
    sql: Sql,
    embed: Embedder,
    onProgress: (message: string) => void = () => {},
): Promise<SeedReport> {
    const duplicates = duplicateSlugs(SHTAB_KB_SEED.map((r) => r.slug));
    if (duplicates.length > 0) {
        throw new Error(`Повторяющиеся slug в kb-content.ts: ${duplicates.join(', ')}`);
    }

    const existing = await sql<{ slug: string; fp: string | null }[]>`
        SELECT slug, metadata_fingerprint AS fp FROM public.shtab_kb
    `;
    const fpBySlug = new Map(existing.map((r) => [r.slug, r.fp]));

    const report: SeedReport = { inserted: [], updated: [], unchanged: [], deactivated: [] };

    for (const row of SHTAB_KB_SEED) {
        const text = formatShtabKbForEmbedding(row);
        const fp = kbFingerprint(text);

        // Текст не менялся — эмбеддинг тот же, и платить за него второй раз незачем.
        if (fpBySlug.get(row.slug) === fp) {
            report.unchanged.push(row.slug);
            continue;
        }

        const embedding = await embed(text);
        const vector = `[${embedding.join(',')}]`;
        const wasThere = fpBySlug.has(row.slug);

        await sql`
            INSERT INTO public.shtab_kb
                (slug, type, title, content, tags, source_ref, is_active, embedding, metadata_fingerprint, updated_at)
            VALUES (
                ${row.slug}, ${row.type}, ${row.title}, ${row.content},
                ${row.tags}, ${row.sourceRef}, true, ${vector}::vector, ${fp}, now()
            )
            ON CONFLICT (slug) DO UPDATE SET
                type       = EXCLUDED.type,
                title      = EXCLUDED.title,
                content    = EXCLUDED.content,
                tags       = EXCLUDED.tags,
                source_ref = EXCLUDED.source_ref,
                is_active  = true,
                embedding  = EXCLUDED.embedding,
                metadata_fingerprint = EXCLUDED.metadata_fingerprint,
                updated_at = now()
        `;

        (wasThere ? report.updated : report.inserted).push(row.slug);
        onProgress(`  ${wasThere ? 'обновил' : 'добавил'} ${row.slug} — ${row.title}`);
    }

    // Статью, выброшенную из kb-content.ts, гасим, а не удаляем: вернут — не
    // придётся платить за эмбеддинг заново, и видно, что она когда-то была.
    const slugs = SHTAB_KB_SEED.map((r) => r.slug);
    const removed = await sql<{ slug: string }[]>`
        UPDATE public.shtab_kb
           SET is_active = false, updated_at = now()
         WHERE is_active AND slug <> ALL(${slugs})
        RETURNING slug
    `;
    for (const r of removed) {
        report.deactivated.push(r.slug);
        onProgress(`  погасил ${r.slug} — статьи больше нет в kb-content.ts`);
    }

    return report;
}
