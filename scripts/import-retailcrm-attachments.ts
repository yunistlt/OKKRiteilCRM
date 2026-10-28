/**
 * Забрать в ОКК вложения заказов, которые остались в RetailCRM.
 *
 * Зачем. Письма, отправленные из почтового модуля RetailCRM, шли мимо нашего
 * ящика rop@zmktlt.ru, поэтому ночная выкачка переписки их вложения не взяла:
 * в заказе 54677 у нас не было семи сентябрьских КП и счетов, а в RetailCRM
 * они есть. API их тоже не отдаёт — `/api/v5/files` по такому заказу возвращает
 * пустой список. Единственное место, где они видны, — интерфейс RetailCRM.
 *
 * Откуда список. Интерфейс берёт их внутренним GraphQL (`POST /app/api/batch`,
 * поле `order.attachments`), а сами файлы лежат в S3 по ссылкам, которые
 * открываются без авторизации. Список снят из интерфейса под учётной записью
 * один раз и лежит файлом; сюда он приходит аргументом. Повторно снять его
 * можно тем же запросом, пока жив аккаунт RetailCRM (он заморожен с октября).
 *
 * Что делает скрипт. Идёт по списку и для каждой пары «заказ + файл»:
 *   1. смотрит, нет ли уже такого файла в заказе (имя и размер) — если есть,
 *      не качает ничего: так отсеивается всё, что уже принесла почта;
 *   2. качает файл с S3 и кладёт в наш бакет;
 *   3. пишет строку в файлы заказа через общего писателя `attachMailFileToOrder`.
 *
 * Дедуп по содержимому. Один и тот же сертификат разослан по сотням заказов
 * (`Новый_сушильные_шкафы_сертификат_ПОБТ.pdf` — 462 заказа). Путь в хранилище
 * считаем от имени и размера, поэтому в бакете он лежит один раз, а строки в
 * заказах ссылаются на один объект: 14,8 ГБ ссылок укладываются в 7,1 ГБ.
 *
 * Дата файла. В RetailCRM её нет ни в одном поле GraphQL, но она зашита в имени
 * объекта на S3: первые восемь шестнадцатеричных знаков — Unix-время загрузки
 * (`6aba26e3…` = 28.09.2026, сверено с окном «Файлы к заказу»). Берём её, иначе
 * в списке файлов у старого КП стояло бы сегодняшнее число.
 *
 * Запуск:
 *   npx tsx scripts/import-retailcrm-attachments.ts ~/Downloads/retailcrm-attachments.json
 *   npx tsx scripts/import-retailcrm-attachments.ts <файл> --apply
 *   npx tsx scripts/import-retailcrm-attachments.ts <файл> --apply --limit 50 --order 54677
 */
import { config } from 'dotenv';
import { readFileSync } from 'node:fs';

config({ path: '.env.local' });

type Row = { order: string; date: string; url: string; name: string; size: number };

/** Тот же порог, что у ручной загрузки и у вложений писем. */
const MAX_BYTES = 25 * 1024 * 1024;

const BUCKET = 'okk-assets';

/** Сколько раз пробуем скачать файл, прежде чем отложить его до следующего прохода. */
const TRIES = 3;

function arg(name: string): string | null {
    const i = process.argv.indexOf(`--${name}`);
    return i > -1 ? (process.argv[i + 1] ?? null) : null;
}

/**
 * Дата загрузки файла в RetailCRM из имени объекта.
 *
 * Имя вида `6aba26e35e728-kp.pdf`: первые восемь знаков — секунды Unix. У части
 * файлов (старое хранилище `attached_files`, имена без метки) её нет — тогда
 * null, и в списке останется дата записи.
 */
function uploadedAt(url: string): string | null {
    const hex = /\/([0-9a-f]{8})[0-9a-f]{5}-/.exec(url);
    if (!hex) return null;

    const seconds = parseInt(hex[1], 16);
    if (!Number.isFinite(seconds)) return null;

    const at = new Date(seconds * 1000);
    // Отсекаем случайные совпадения: файлов до 2015 и из будущего не бывает.
    const year = at.getUTCFullYear();
    if (year < 2015 || year > new Date().getUTCFullYear() + 1) return null;

    return at.toISOString();
}

async function main() {
    const file = process.argv[2];
    if (!file || file.startsWith('--')) {
        console.error('Укажите файл со списком: npx tsx scripts/import-retailcrm-attachments.ts <файл.json>');
        process.exit(1);
    }

    const apply = process.argv.includes('--apply');
    const only = arg('order');
    const limit = Number(arg('limit') ?? 0) || 0;

    const { supabase } = await import('@/utils/supabase');
    const { attachMailFileToOrder } = await import('@/lib/email/attachments');
    const { safeStorageSegment } = await import('@/lib/storage-path');

    let rows: Row[] = JSON.parse(readFileSync(file, 'utf8'));
    if (only) rows = rows.filter((r) => String(r.order) === only);

    /** Что уже лежит в заказах: пара «заказ + имя + размер». */
    const have = new Set<string>();
    const orders = [...new Set(rows.map((r) => String(r.order)))];
    for (let i = 0; i < orders.length; i += 500) {
        const { data } = await supabase
            .from('order_files')
            .select('order_number, file_name, size_bytes')
            .in('order_number', orders.slice(i, i + 500))
            .is('deleted_at', null);
        for (const row of (data ?? []) as any[]) {
            have.add(`${row.order_number}|${row.file_name}|${row.size_bytes}`);
        }
    }

    const todo = rows.filter((r) => !have.has(`${r.order}|${r.name}|${r.size}`));
    const heavy = todo.filter((r) => r.size > MAX_BYTES);
    const work = todo.filter((r) => r.size <= MAX_BYTES).slice(0, limit || undefined);

    const uniqueFiles = new Set(work.map((r) => `${r.name}|${r.size}`));
    const bytes = [...uniqueFiles].reduce((sum, key) => sum + Number(key.split('|').pop()), 0);

    console.log(`в списке: ${rows.length}`);
    console.log(`уже в ОКК: ${rows.length - todo.length}`);
    console.log(`к заливке: ${work.length} строк, ${uniqueFiles.size} файлов, ${(bytes / 1073741824).toFixed(2)} ГБ`);
    if (heavy.length) console.log(`тяжелее 25 МБ, пропускаем: ${heavy.length}`);

    if (!apply) {
        console.log('\nсухой прогон, ничего не записано — добавьте --apply');
        return;
    }

    /** Путь в бакете по содержимому: один файл на все заказы, где он встречается. */
    const pathOf = (row: Row) => `retailcrm-files/${row.size}-${safeStorageSegment(row.name)}`;

    /** Что уже отправлено в бакет за этот прогон — чтобы не качать повторно. */
    const uploaded = new Set<string>();

    let added = 0;
    let skipped = 0;
    let failed = 0;

    for (const [index, row] of work.entries()) {
        const path = pathOf(row);

        if (!uploaded.has(path)) {
            let body: ArrayBuffer | null = null;

            for (let attempt = 1; attempt <= TRIES && !body; attempt += 1) {
                try {
                    /**
                     * Часть ссылок хранит имя файла как есть — с пробелами и
                     * кириллицей («…/Коммерческое предложение ПОБТ (НДС 5%)…»).
                     * Такой адрес S3 отвергает с HTTP 400, пока его не закодировать.
                     */
                    let response = await fetch(encodeURI(row.url));
                    if (!response.ok) response = await fetch(row.url);
                    if (!response.ok) throw new Error(`HTTP ${response.status}`);
                    body = await response.arrayBuffer();
                } catch (error) {
                    if (attempt === TRIES) {
                        console.warn(`не скачался: ${row.name} — ${(error as Error).message}`);
                        failed += 1;
                    } else {
                        await new Promise((r) => setTimeout(r, 1000 * attempt));
                    }
                }
            }

            if (!body) continue;

            const upload = await supabase.storage.from(BUCKET).upload(path, new Uint8Array(body), {
                contentType: 'application/octet-stream',
                upsert: true,
            });

            if (upload.error) {
                console.warn(`не сохранился: ${row.name} — ${upload.error.message}`);
                failed += 1;
                continue;
            }

            uploaded.add(path);
        }

        const written = await attachMailFileToOrder({
            orderNumber: String(row.order),
            fileName: row.name,
            contentType: null,
            size: row.size,
            path,
            fromName: 'RetailCRM',
            sourceAt: uploadedAt(row.url),
            note: 'Вложение письма RetailCRM',
        });

        if (written) added += 1;
        else skipped += 1;

        if ((index + 1) % 200 === 0) {
            console.log(`${index + 1} / ${work.length} — записано ${added}, было ${skipped}, не вышло ${failed}`);
        }
    }

    console.log(`\nготово: записано ${added}, уже было ${skipped}, не вышло ${failed}`);
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
