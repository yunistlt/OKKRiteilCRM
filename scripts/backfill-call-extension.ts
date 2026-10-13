/**
 * Проставить добавочный у уже принятых звонков.
 *
 * Колонка `manager_extension` появилась 12.10.2026, чтобы список звонков не
 * разбирал ноги разговора на каждом показе. Старые записи заполняем разово —
 * тем же кодом, что и приём звонка.
 *
 * Запуск: npx tsx scripts/backfill-call-extension.ts [--days=90]
 */
import { config } from 'dotenv';

config({ path: '.env.local' });

async function main() {
    const days = Number(process.argv.find((a) => a.startsWith('--days='))?.split('=')[1] ?? 90);
    const { supabase } = await import('../utils/supabase');
    const { callExtension } = await import('../lib/calls/extension');

    const since = new Date(Date.now() - days * 86_400_000).toISOString();
    let filled = 0;
    let seen = 0;
    let from = 0;
    const page = 200;

    for (;;) {
        const { data, error } = await supabase
            .from('raw_telphin_calls')
            .select('telphin_call_id, direction, raw_payload')
            .is('manager_extension', null)
            .gt('started_at', since)
            .order('started_at', { ascending: false })
            .range(from, from + page - 1);

        if (error) {
            console.error('не прочиталось:', error.message);
            process.exit(1);
        }

        const rows = (data ?? []) as any[];
        if (!rows.length) break;
        seen += rows.length;

        for (const row of rows) {
            const extension = callExtension(row);
            if (!extension) continue;

            const { error: saveError } = await supabase
                .from('raw_telphin_calls')
                .update({ manager_extension: extension })
                .eq('telphin_call_id', row.telphin_call_id);

            if (!saveError) filled += 1;
        }

        console.log(`просмотрено ${seen}, проставлено ${filled}`);
        // Страницу не сдвигаем: заполненные строки уходят из выборки сами.
        if (rows.length < page) break;
    }

    console.log(`\nготово: просмотрено ${seen}, добавочный проставлен у ${filled}`);
}

main();
