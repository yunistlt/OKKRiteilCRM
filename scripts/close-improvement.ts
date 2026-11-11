/**
 * Отметить доработку выполненной и объяснить автору, что сделано.
 *
 * То же, что кнопка «Выполнено» в реестре: пишет пояснение и сборку, а автору
 * уходит сообщение от бота. Скрипт нужен, когда закрываем пачкой (поручение
 * владельца 22.10.2026).
 *
 * Запуск:
 *   npx tsx scripts/close-improvement.ts --id=27 --note="…" --build=114df16
 *   то же с --apply, чтобы записать и отправить.
 *
 * Запись, которую мы делать не будем, закрывается с ключом --reject: отметка
 * та же, но автору уходит честное «делать не будем» с причиной, а не
 * «выполнено». Врать человеку, который потратил время на заявку, нельзя
 * (решение владельца 06.11.2026 по записям 60 и 73).
 */
import { config } from 'dotenv';
config({ path: '.env.local' });

const arg = (name: string): string | null =>
    process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=').slice(1).join('=') ?? null;

const APPLY = process.argv.includes('--apply');
/** Закрываем без доработки: задача не делается. */
const REJECT = process.argv.includes('--reject');

async function main() {
    const id = Number(arg('id'));
    const note = (arg('note') || '').trim();
    const build = (arg('build') || '').trim() || null;
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

    let managerId = improvement.author_manager_id ? Number(improvement.author_manager_id) : null;
    if (!managerId && improvement.author_email) {
        const { data: user } = await supabase
            .from('users')
            .select('retail_crm_manager_id')
            .or(`email.eq.${improvement.author_email},username.eq.${improvement.author_email}`)
            .maybeSingle();
        managerId = (user as any)?.retail_crm_manager_id ? Number((user as any).retail_crm_manager_id) : null;
    }

    const lines = [
        REJECT
            ? `Доработка №${improvement.id} закрыта — делать не будем.`
            : `Доработка №${improvement.id} выполнена.`,
        '',
        `Вы писали: ${String(improvement.text ?? '').trim()}`,
        '',
        `${REJECT ? 'Почему' : 'Пояснение'}: ${note}`,
    ];
    // Сборки у отказа нет: кода не меняли.
    if (build && !REJECT) lines.push('', `Сборка: ${build}`);
    const text = lines.join('\n');

    console.log(`№${improvement.id} → ${improvement.author_name} (менеджер ${managerId ?? 'не найден'})`);
    console.log(text);
    console.log('───');

    if (!APPLY) {
        console.log('Это показ. Повторите с --apply.');
        return;
    }

    const { error: saveError } = await supabase
        .from('improvements')
        .update({
            done_at: new Date().toISOString(),
            done_by: 'Андрей Теренков',
            // В реестре у отказа видно, что это отказ, а не сделанная работа.
            done_note: REJECT ? `Делать не будем. ${note}` : note,
            done_build: REJECT ? null : build,
        })
        .eq('id', id);

    if (saveError) throw new Error(saveError.message);

    if (managerId) {
        const result = await sendNotification('improvements.done', text, { managerId });
        console.log('Отправка автору:', JSON.stringify(result));
    } else {
        console.log('Адресата нет — отметка поставлена, сообщение не ушло.');
    }
}

main().catch((e) => { console.error(e.message); process.exit(1); });
