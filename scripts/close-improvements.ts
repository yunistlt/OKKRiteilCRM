/**
 * Отметка «выполнено» в реестре доработок пачкой — после выкатки.
 *
 * Руками в интерфейсе это десяток окон подряд с текстом пояснения в каждом.
 * Скрипт берёт тот же код, что и кнопка (lib/improvements/close.ts), поэтому
 * автор доработки получает сообщение так же, как при нажатии кнопки.
 *
 * Список — JSON-файл: [{ "id": 58, "note": "Что сделано" }, ...]
 *
 * Сухой прогон (ничего не пишет, ничего не отправляет):
 *   npx tsx scripts/close-improvements.ts notes.json --build=e21aeef
 * Запись и сообщения авторам:
 *   npx tsx scripts/close-improvements.ts notes.json --build=e21aeef --apply
 */
import { config } from 'dotenv';
config({ path: '.env.local' });

import { readFileSync } from 'fs';

type Note = { id: number; note: string };

async function main() {
    const args = process.argv.slice(2);
    const file = args.find((a) => !a.startsWith('--'));
    const apply = args.includes('--apply');
    const build = (args.find((a) => a.startsWith('--build=')) ?? '').split('=')[1] || null;
    // Кто поставил отметку. По умолчанию «Клод» — так подписаны прошлые
    // отметки, сделанные не нажатием кнопки: в реестре видно, чья это рука.
    const by = (args.find((a) => a.startsWith('--by=')) ?? '').split('=')[1] || 'Клод';

    if (!file) {
        console.error('Укажите JSON-файл со списком: [{ "id": 58, "note": "..." }]');
        process.exit(1);
    }

    const notes: Note[] = JSON.parse(readFileSync(file, 'utf8'));
    const { supabase } = await import('../utils/supabase');
    const { closeImprovement } = await import('../lib/improvements/close');

    const { data: rows, error } = await supabase
        .from('improvements')
        .select('id, text, author_name, author_manager_id, done_at')
        .in('id', notes.map((n) => n.id));

    if (error) throw new Error(error.message);
    const byId = new Map((rows ?? []).map((r: any) => [Number(r.id), r]));

    for (const item of notes) {
        const row = byId.get(Number(item.id));
        if (!row) {
            console.log(`№${item.id}: записи нет — пропускаю`);
            continue;
        }
        if (row.done_at) {
            console.log(`№${item.id}: уже отмечена ${row.done_at} — пропускаю`);
            continue;
        }

        console.log(`№${item.id} (${row.author_name ?? 'без автора'})`);
        console.log(`  просили: ${String(row.text ?? '').replace(/\s+/g, ' ').slice(0, 120)}`);
        console.log(`  пояснение: ${item.note}`);
        console.log(`  сообщение автору: ${row.author_manager_id ? 'уйдёт' : 'не уйдёт — нет номера менеджера'}`);

        if (!apply) continue;

        await closeImprovement(item.id, { note: item.note, build, by });
        console.log('  отмечено');
    }

    if (!apply) console.log('\nСухой прогон. Для записи добавьте --apply');
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
