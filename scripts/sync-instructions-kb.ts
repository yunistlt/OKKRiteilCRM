/**
 * Инструкции → база знаний Семёна.
 *
 * ЗАКОН владельца 05.10.2026: каждую возможность и правило системы описываем
 * один раз — в инструкции — и она же попадает в знания Семёна. Отдельных
 * «правил» рядом с инструкцией не держим: один текст, одна разметка, один
 * скрипт («чтобы не плодить кода и текста»).
 *
 * Что делает: режет инструкцию по разделам «## Заголовок» и кладёт каждый
 * раздел отдельной записью с векторным указателем. Так Семён отвечает нужным
 * куском, а не пересказывает всю простыню, и на вопрос «можно ли править
 * реквизиты в заказе» находит именно этот раздел.
 *
 * Запускать после правки инструкций:
 *   npx tsx scripts/sync-instructions-kb.ts
 */
import { config } from 'dotenv';
config({ path: '.env.local' });

type Chunk = { slug: string; title: string; content: string };

/** Разделы инструкции: заголовок «## …» и текст под ним. Шапка — тоже раздел. */
function splitIntoSections(slug: string, title: string, content: string): Chunk[] {
    const lines = String(content ?? '').split('\n');
    const sections: Array<{ heading: string | null; body: string[] }> = [{ heading: null, body: [] }];

    for (const line of lines) {
        if (line.startsWith('## ')) sections.push({ heading: line.slice(3).trim(), body: [] });
        else sections[sections.length - 1].body.push(line);
    }

    return sections
        .map((section, index) => {
            const body = section.body.join('\n').trim();
            if (body.length < 40) return null;

            // Разметку для глаз («!!», «??», «**») в знания не тащим: Семён
            // пересказывает смысл, а не рисует плашки.
            const plain = body
                .replace(/^!!\s*/gm, 'Важно: ')
                .replace(/^\?\?\s*/gm, 'Подсказка: ')
                .replace(/\*\*/g, '');

            return {
                slug: `${slug}#${index}`,
                title: section.heading ? `${title} — ${section.heading}` : title,
                content: plain,
            };
        })
        .filter(Boolean) as Chunk[];
}

async function main() {
    const { supabase } = await import('../utils/supabase');
    const { generateEmbedding } = await import('../lib/embeddings');

    const { data, error } = await supabase
        .from('okk_consultant_knowledge')
        .select('slug, title, content, section_key, tags')
        .eq('type', 'instruction')
        .eq('is_active', true);

    if (error) throw new Error(error.message);

    const instructions = (data ?? []) as any[];
    let written = 0;

    for (const instruction of instructions) {
        const chunks = splitIntoSections(instruction.slug, instruction.title, instruction.content);

        for (const chunk of chunks) {
            const embedding = await generateEmbedding(`${chunk.title}\n\n${chunk.content}`);
            if (!embedding.length) {
                console.warn('указатель не посчитался:', chunk.slug);
                continue;
            }

            const { error: saveError } = await supabase
                .from('okk_consultant_knowledge')
                .upsert({
                    slug: chunk.slug,
                    // Кусок инструкции: справка его не показывает, он только для поиска.
                    type: 'instruction_chunk',
                    section_key: instruction.section_key,
                    title: chunk.title,
                    content: chunk.content,
                    tags: instruction.tags,
                    is_active: true,
                    embedding,
                }, { onConflict: 'slug' });

            if (saveError) console.warn('не сохранился кусок:', chunk.slug, saveError.message);
            else written += 1;
        }

        console.log(`${instruction.slug}: разделов ${chunks.length}`);
    }

    // Убираем куски инструкций, которых больше нет.
    const liveSlugs = instructions.flatMap((i) =>
        splitIntoSections(i.slug, i.title, i.content).map((c) => c.slug));

    const { data: stale } = await supabase
        .from('okk_consultant_knowledge')
        .select('slug')
        .eq('type', 'instruction_chunk');

    const extra = ((stale ?? []) as any[])
        .map((row) => String(row.slug))
        .filter((slug) => !liveSlugs.includes(slug));

    if (extra.length) {
        await supabase.from('okk_consultant_knowledge').delete().in('slug', extra);
        console.log('удалено устаревших кусков:', extra.length);
    }

    console.log(`инструкций: ${instructions.length}, кусков записано: ${written}`);
}

main().catch((e) => { console.error(e.message); process.exit(1); });
