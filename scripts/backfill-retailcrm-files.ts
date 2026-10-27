/**
 * Дотянуть файлы заказов из RetailCRM в ОКК.
 *
 * Перенос 02.10.2026 оборвался на полпути: в файловом разделе RetailCRM
 * 33 444 файла по 15 070 заказам, у нас оказалось 21 721 по 9 326 — не хватало
 * 11 586 файлов по 6 065 заказам (сверка 13.10.2026). Скрипт доносит
 * недостающее и ничего не трогает из уже перенесённого.
 *
 * Идемпотентность — по пути в хранилище: `order-files/<номер>/retailcrm/<id>-<имя>`,
 * где `<id>` — номер файла в RetailCRM. Тот же файл второй раз не заведётся,
 * даже если имя у него не уникальное (в прошлом переносе так появились дубли).
 *
 * Запуск:
 *   npx tsx scripts/backfill-retailcrm-files.ts            — показать, сколько не хватает
 *   npx tsx scripts/backfill-retailcrm-files.ts --apply    — перенести
 *   … --limit=500                                          — перенести частями
 *   … --months=0                                           — не ограничивать возрастом заказа
 *
 * По умолчанию берём только заказы моложе 18 месяцев (решение владельца
 * 27.10.2026): у архива 2016–2024 годов файлы уже никому не нужны, а место на
 * слабом диске базы и в хранилище они занимают.
 */
import { config } from 'dotenv';

config({ path: '.env.local' });

const BUCKET = 'okk-assets';
/** Крупнее этого в RetailCRM не бывает; защита от неожиданностей. */
const MAX_BYTES = 100 * 1024 * 1024;

type CrmFile = { id: number; filename: string; type: string | null; size: number; order: string };

async function crmFiles(base: string, key: string): Promise<CrmFile[]> {
    const out: CrmFile[] = [];
    for (let page = 1; ; page++) {
        const res = await fetch(`${base}/api/v5/files?limit=100&page=${page}&apiKey=${key}`);
        const data: any = await res.json().catch(() => ({}));
        const files: any[] = data?.files ?? [];

        for (const file of files) {
            const order = (file.attachment ?? []).find((a: any) => a.order)?.order?.number;
            if (!order) continue;
            out.push({
                id: Number(file.id),
                filename: String(file.filename ?? `file-${file.id}`),
                type: file.type ?? null,
                size: Number(file.size ?? 0),
                order: String(order),
            });
        }

        if (files.length < 100) break;
        if (page % 50 === 0) console.log(`  … прочитано ${out.length} файлов`);
    }
    return out;
}

async function main() {
    const apply = process.argv.includes('--apply');
    const limit = Number(process.argv.find((a) => a.startsWith('--limit='))?.split('=')[1] ?? 0);
    const monthsArg = process.argv.find((a) => a.startsWith('--months='))?.split('=')[1];
    const months = monthsArg === undefined ? 18 : Number(monthsArg);

    const base = process.env.RETAILCRM_URL;
    const key = process.env.RETAILCRM_API_KEY;
    if (!base || !key) {
        console.error('нет доступа к RetailCRM: задайте RETAILCRM_URL и RETAILCRM_API_KEY');
        process.exit(1);
    }

    const { supabase } = await import('../utils/supabase');
    const { safeStorageSegment } = await import('../lib/storage-path');

    console.log('читаю файлы RetailCRM…');
    const files = await crmFiles(base, key);
    console.log(`в RetailCRM привязано к заказам: ${files.length}`);

    /**
     * Возраст заказа считаем по нашей базе: в списке файлов RetailCRM есть
     * дата файла, но не дата заказа, а решение владельца — про заказы.
     */
    let fresh = files;
    if (months > 0) {
        const cutoff = new Date();
        cutoff.setMonth(cutoff.getMonth() - months);

        const recent = new Set<string>();
        for (let from = 0; ; from += 1000) {
            const { data, error } = await supabase
                .from('orders')
                .select('number')
                .gte('created_at', cutoff.toISOString())
                .range(from, from + 999);

            if (error) {
                console.error('заказы не прочитались:', error.message);
                process.exit(1);
            }
            const page = (data ?? []) as any[];
            for (const row of page) recent.add(String(row.number));
            if (page.length < 1000) break;
        }

        fresh = files.filter((file) => recent.has(file.order));
        console.log(
            `заказов моложе ${months} мес.: ${recent.size}; файлов по ним: ${fresh.length}`
            + ` (отложено как старьё: ${files.length - fresh.length})`,
        );
    }

    // Что уже лежит у нас — по пути в хранилище.
    const have = new Set<string>();
    for (let from = 0; ; from += 1000) {
        const { data, error } = await supabase
            .from('order_files')
            .select('storage_path')
            .not('storage_path', 'is', null)
            .range(from, from + 999);

        if (error) {
            console.error('не прочиталось:', error.message);
            process.exit(1);
        }
        const page = (data ?? []) as any[];
        for (const row of page) have.add(String(row.storage_path));
        if (page.length < 1000) break;
    }
    console.log(`у нас файлов в хранилище: ${have.size}`);

    const pathOf = (file: CrmFile) =>
        `order-files/${safeStorageSegment(file.order, 40)}/retailcrm/${file.id}-${safeStorageSegment(file.filename)}`;

    const todo = fresh.filter((file) => !have.has(pathOf(file)));
    const bytes = todo.reduce((sum, file) => sum + file.size, 0);
    console.log(`не перенесено: ${todo.length} файлов по ${new Set(todo.map((f) => f.order)).size} заказам, ${(bytes / 1024 / 1024).toFixed(0)} МБ`);

    if (!apply) {
        console.log('\nэто предварительный показ, для переноса добавьте --apply');
        return;
    }

    const batch = limit > 0 ? todo.slice(0, limit) : todo;
    let done = 0;
    let failed = 0;
    const today = new Date().toISOString().slice(0, 10);

    for (const file of batch) {
        const path = pathOf(file);
        try {
            if (file.size > MAX_BYTES) throw new Error(`слишком большой (${file.size} байт)`);

            const res = await fetch(`${base}/api/v5/files/${file.id}/download?apiKey=${key}`);
            if (!res.ok) throw new Error(`скачивание: ${res.status}`);
            const content = Buffer.from(await res.arrayBuffer());

            const upload = await supabase.storage.from(BUCKET).upload(path, new Uint8Array(content), {
                contentType: file.type || 'application/octet-stream',
                upsert: true,
            });
            if (upload.error) throw new Error(`хранилище: ${upload.error.message}`);

            const { error } = await supabase.from('order_files').insert({
                order_number: file.order,
                file_name: file.filename,
                content_type: file.type,
                size_bytes: content.length,
                storage_bucket: BUCKET,
                storage_path: path,
                note: `Файл заказа из RetailCRM от ${today}`,
                uploaded_by: 'Перенесено из RetailCRM',
            });
            if (error) throw new Error(`запись: ${error.message}`);

            done += 1;
            if (done % 100 === 0) console.log(`  перенесено ${done} из ${batch.length}`);
        } catch (e: any) {
            failed += 1;
            console.error(`файл ${file.id} (заказ ${file.order}, ${file.filename}): ${e?.message || e}`);
        }
    }

    console.log(`\nготово: перенесено ${done}, не вышло ${failed}`);
    if (limit > 0 && todo.length > batch.length) {
        console.log(`осталось ${todo.length - batch.length} — запустите скрипт ещё раз`);
    }
}

void main();
