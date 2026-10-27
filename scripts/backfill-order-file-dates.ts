/**
 * Проставить файлам заказа дату их письма.
 *
 * До 27.10.2026 в списке файлов у вложений стояло число, когда мы забрали
 * файл, — у письма полугодовой давности это выглядело сегодняшним днём.
 * Теперь дату письма пишем сразу (`order_files.source_at`), а этот скрипт
 * проставляет её тем файлам, что записаны раньше.
 *
 * Связь находим по пути в хранилище: `email-files/<id письма>/<имя>` — для
 * входящих и `order-files/<заказ>/<id письма>/<имя>` — для докачанных по
 * кнопке. Чего связать не вышло, оставляем как есть.
 *
 * Запуск:
 *   npx tsx scripts/backfill-order-file-dates.ts           — показать
 *   npx tsx scripts/backfill-order-file-dates.ts --apply   — проставить
 */
import { config } from 'dotenv';

config({ path: '.env.local' });

const PAGE = 500;

/**
 * Какое письмо лежит за файлом.
 *
 * Пути разные: `email-files/<id входящего>/…`, `email-files/sent-<id нашего>/…`
 * и `order-files/<заказ>/<id входящего>/…` у докачанных по ссылке.
 */
function letterFrom(path: string): { table: 'incoming_emails' | 'outgoing_emails'; id: string } | null {
    const sent = /^email-files\/sent-([^/]+)\//.exec(path);
    if (sent) return { table: 'outgoing_emails', id: sent[1] };

    const email = /^email-files\/([^/]+)\//.exec(path);
    if (email) return { table: 'incoming_emails', id: email[1] };

    const order = /^order-files\/[^/]+\/([0-9a-f-]{36})\//.exec(path);
    return order ? { table: 'incoming_emails', id: order[1] } : null;
}

async function main() {
    const apply = process.argv.includes('--apply');
    const { supabase } = await import('../utils/supabase');

    let seen = 0;
    let matched = 0;
    let saved = 0;

    for (let from = 0; ; from += PAGE) {
        const { data, error } = await supabase
            .from('order_files')
            .select('id, storage_path, created_at, source_at')
            .is('source_at', null)
            .not('storage_path', 'is', null)
            .order('id', { ascending: true })
            .range(from, from + PAGE - 1);

        if (error) {
            console.error('не прочиталось:', error.message);
            process.exit(1);
        }

        const rows = (data ?? []) as any[];
        seen += rows.length;

        for (const row of rows) {
            const letter = letterFrom(String(row.storage_path));
            if (!letter) continue;

            const { data: found } = await supabase
                .from(letter.table)
                .select(letter.table === 'incoming_emails' ? 'received_at' : 'sent_at')
                .eq('id', letter.id)
                .maybeSingle();

            const receivedAt = (found as any)?.received_at ?? (found as any)?.sent_at;
            if (!receivedAt) continue;

            matched += 1;
            if (!apply) continue;

            const { error: saveError } = await supabase
                .from('order_files')
                .update({ source_at: receivedAt })
                .eq('id', row.id);

            if (saveError) console.warn(`  ${row.id}: ${saveError.message}`);
            else saved += 1;
        }

        if (rows.length < PAGE) break;
    }

    console.log(`файлов без даты письма: ${seen}, нашли письмо у ${matched}${apply ? `, проставлено ${saved}` : ''}`);
    if (!apply) console.log('\nэто предварительный показ, для записи добавьте --apply');
}

void main();
