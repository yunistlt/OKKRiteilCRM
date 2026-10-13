/**
 * Завести или обновить инструкцию из файла.
 *
 * ЗАКОН владельца: каждая возможность описана один раз — инструкцией, и она же
 * становится знанием Семёна. Текст держим файлом в репозитории, чтобы он
 * правился вместе с кодом, а этим скриптом кладём его в базу.
 *
 * Запуск:
 *   npx tsx scripts/add-instruction.ts --file=docs/instructions/order-mail.md \
 *     --slug=instruction:order-mail --section=orders \
 *     --title="Переписка по заказу" --tags="письма,переписка,почта,вложения"
 *
 * После этого — `npx tsx scripts/sync-instructions-kb.ts` (считает векторные
 * указатели через OpenAI, это платно).
 */
import { readFileSync } from 'fs';
import { config } from 'dotenv';

config({ path: '.env.local' });

const arg = (name: string): string | null =>
    process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=').slice(1).join('=') ?? null;

async function main() {
    const file = arg('file');
    const slug = arg('slug');
    const title = arg('title');
    const section = arg('section') || 'orders';
    const tags = (arg('tags') || '').split(',').map((t) => t.trim()).filter(Boolean);

    if (!file || !slug || !title) {
        console.error('Нужны --file, --slug и --title');
        process.exit(1);
    }

    const { supabase } = await import('../utils/supabase');
    const content = readFileSync(file, 'utf8');

    const { error } = await supabase
        .from('okk_consultant_knowledge')
        .upsert({
            slug,
            type: 'instruction',
            section_key: section,
            title,
            content,
            tags: tags.length ? tags : null,
            is_active: true,
        }, { onConflict: 'slug' });

    if (error) {
        console.error(`не записалась: ${error.message}`);
        process.exit(1);
    }

    console.log(`инструкция «${title}» записана (${slug}), разделов: ${content.split('\n## ').length}`);
    console.log('дальше: npx tsx scripts/sync-instructions-kb.ts — он посчитает указатели (платный вызов OpenAI)');
}

main();
