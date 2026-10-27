/**
 * Починить уже записанные письма, которые соврали о своей кодировке.
 *
 * Разбор писем теперь выправляет такие тексты на входе
 * (`lib/email/mojibake.ts`), но в базе осталось то, что записано раньше —
 * например «Отзыв: [#2/53005]» в заказе 53005 (27.10.2026).
 *
 * Запуск:
 *   npx tsx scripts/fix-mail-mojibake.ts           — показать, сколько битых
 *   npx tsx scripts/fix-mail-mojibake.ts --apply   — починить
 *
 * У базы слабый диск (ЗАКОН 16.10.2026): идём маленькими порциями.
 */
import { config } from 'dotenv';

config({ path: '.env.local' });

/**
 * Страницы маленькие: тела писем тяжёлые, и выборка по 500 строк упиралась
 * в таймаут запроса (у базы слабый диск, ЗАКОН 16.10.2026).
 */
const PAGE = 100;

async function main() {
    const apply = process.argv.includes('--apply');
    const { supabase } = await import('../utils/supabase');
    const { fixCharsetMojibake } = await import('../lib/email/mojibake');

    for (const table of ['incoming_emails', 'outgoing_emails']) {
        let broken = 0;
        let fixed = 0;

        for (let from = 0; ; from += PAGE) {
            const { data, error } = await supabase
                .from(table)
                .select('id, subject, body_text, body_html')
                .order('id', { ascending: true })
                .range(from, from + PAGE - 1);

            if (error) {
                console.error(`${table}: не прочиталось — ${error.message}`);
                process.exit(1);
            }

            const rows = (data ?? []) as any[];
            for (const row of rows) {
                const text = fixCharsetMojibake(row.body_text);
                const html = fixCharsetMojibake(row.body_html);
                if (text === row.body_text && html === row.body_html) continue;

                broken += 1;
                if (!apply) {
                    if (broken <= 5) console.log(`  ${table} ${row.id}: ${String(row.subject ?? '').slice(0, 50)}`);
                    continue;
                }

                const { error: saveError } = await supabase
                    .from(table)
                    .update({ body_text: text, body_html: html })
                    .eq('id', row.id);

                if (saveError) console.warn(`  ${table} ${row.id}: ${saveError.message}`);
                else fixed += 1;
            }

            if (rows.length < PAGE) break;
        }

        console.log(`${table}: с поломанной кодировкой ${broken}${apply ? `, починено ${fixed}` : ''}`);
    }

    if (!apply) console.log('\nэто предварительный показ, для починки добавьте --apply');
}

void main();
