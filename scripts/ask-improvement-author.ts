/**
 * Спросить автора доработки, что он имел в виду — из командной строки.
 *
 * В интерфейсе это кнопка «Спросить автора» в реестре доработок; скрипт нужен
 * для разовых случаев, когда вопрос задаётся не из браузера (решение владельца
 * 22.10.2026 по доработке №36).
 *
 * Запуск:
 *   npx tsx scripts/ask-improvement-author.ts --id=36 --note="текст вопроса"
 *   npx tsx scripts/ask-improvement-author.ts --id=36 --note="…" --apply
 *
 * Без --apply только показывает, что уйдёт и кому.
 */
import { config } from 'dotenv';
config({ path: '.env.local' });

const arg = (name: string): string | null =>
    process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=').slice(1).join('=') ?? null;

const APPLY = process.argv.includes('--apply');

async function main() {
    const id = Number(arg('id'));
    const note = (arg('note') || '').trim();
    if (!Number.isFinite(id) || !note) {
        console.error('Нужны --id и --note');
        process.exit(1);
    }

    const { supabase } = await import('../utils/supabase');
    const { sendNotification } = await import('../lib/notify/send');

    const { data: row, error } = await supabase
        .from('improvements')
        .select('id, text, author_name, author_email, author_manager_id, done_at')
        .eq('id', id)
        .maybeSingle();

    if (error) throw new Error(error.message);
    if (!row) throw new Error(`Доработки №${id} нет`);

    const improvement = row as any;
    if (improvement.done_at) {
        console.warn('Доработка уже закрыта — вопрос всё равно отправим.');
    }

    let managerId = improvement.author_manager_id ? Number(improvement.author_manager_id) : null;
    if (!managerId && improvement.author_email) {
        const { data: user } = await supabase
            .from('users')
            .select('retail_crm_manager_id')
            .or(`email.eq.${improvement.author_email},username.eq.${improvement.author_email}`)
            .maybeSingle();
        managerId = (user as any)?.retail_crm_manager_id ? Number((user as any).retail_crm_manager_id) : null;
    }

    const text = [
        `По доработке №${improvement.id} нужно уточнение.`,
        '',
        `Вы писали: ${String(improvement.text ?? '').trim()}`,
        '',
        note,
    ].join('\n');

    console.log('Кому:', improvement.author_name, '| менеджер', managerId ?? 'не найден');
    console.log('---');
    console.log(text);
    console.log('---');

    if (!managerId) {
        console.error('Адресата нет — отправлять некуда.');
        process.exit(1);
    }

    if (!APPLY) {
        console.log('Это показ. Повторите с --apply, чтобы отправить.');
        return;
    }

    await supabase
        .from('improvements')
        .update({
            clarify_note: note,
            clarify_at: new Date().toISOString(),
            clarify_by: 'Андрей Теренков',
        })
        .eq('id', id);

    const result = await sendNotification('improvements.clarify', text, { managerId });
    console.log('Отправка:', JSON.stringify(result));
}

main().catch((e) => { console.error(e.message); process.exit(1); });
