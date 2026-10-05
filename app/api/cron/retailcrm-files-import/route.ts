import { NextResponse } from 'next/server';
import { isCronHeaderAuthorized } from '@/lib/cron-auth';
import { supabase } from '@/utils/supabase';
import { getCrmConfig } from '@/lib/retailcrm/leads';
import { safeStorageSegment } from '@/lib/storage-path';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/**
 * Перенос файлов заказов из RetailCRM к нам.
 *
 * Менеджеры 02.10.2026: «файлы из СРМ не подтянулись — нет ни КП, ни счетов, ни
 * паспортов, переношу вручную». RetailCRM — временный источник (курс на свою
 * CRM), поэтому забираем бинарь себе, а не ссылаемся на него.
 *
 * Кладём туда же, где лежат остальные файлы заказа: бакет `okk-assets`, путь
 * `order-files/<номер>/retailcrm/<id>-<имя>`, строка в `order_files`. Повторный
 * заход тот же файл не задваивает — проверяем по пути.
 *
 * Идём от свежих к старым пачками: за заход берём столько, сколько успеваем.
 */
const BUCKET = 'okk-assets';
const PAGE = 100;          // RetailCRM отдаёт по 100 — больше нельзя
const PER_RUN = 150;       // сколько файлов скачиваем за один заход (лимит времени — 300 с)
const MAX_BYTES = 25 * 1024 * 1024;
const PROGRESS_KEY = 'retailcrm.files_import.page';

const safeName = (name: string) =>
    (name || 'file')
        .replace(/[^\w.\-Ѐ-ӿ ]+/g, '_')
        .slice(-120)
        .trim();

export async function GET(req: Request) {
    if (!isCronHeaderAuthorized(req)) {
        return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }

    const { url, key } = await getCrmConfig();
    const { searchParams } = new URL(req.url);
    const startPage = Math.max(1, parseInt(searchParams.get('page') || '1', 10));

    // Что уже перенесли — читаем один раз: иначе на каждый файл уходил бы запрос
    // к базе, а заход упирался бы в уже сделанное и не двигался дальше.
    // Читаем постранично: записей десятки тысяч, а выборка по умолчанию
    // обрезается на тысяче — иначе задание начало бы качать всё заново.
    const existing: Array<{ storage_path: string }> = [];
    for (let offset = 0; ; offset += 1000) {
        const { data: chunk } = await supabase
            .from('order_files')
            .select('storage_path')
            .like('storage_path', 'order-files/%/retailcrm/%')
            .is('deleted_at', null)
            .range(offset, offset + 999);
        const rows = (chunk || []) as any[];
        existing.push(...rows);
        if (rows.length < 1000) break;
    }
    // Ключ — идентификатор файла в RetailCRM: он есть в пути и известен до того,
    // как мы полезем в базу за номером заказа.
    const done = new Set(
        existing
            .map((row) => String(row.storage_path).split('/retailcrm/')[1]?.split('-')[0])
            .filter(Boolean),
    );

    let imported = 0;
    let skipped = 0;
    let failed = 0;
    // Где остановились — помним в общей таблице состояний (там же живут отметки
    // остальных синхронизаций). Иначе каждый заход начинал бы с первой страницы
    // и к концу архива тратил бы всё время на пролистывание уже сделанного.
    const { data: saved } = await supabase
        .from('sync_state')
        .select('value')
        .eq('key', PROGRESS_KEY)
        .maybeSingle();

    let page = startPage > 1 ? startPage : Math.max(1, parseInt(String(saved?.value ?? '1'), 10) || 1);
    let totalPages = 1;

    // В лимит захода считаем только реальную работу: пропуски стоят дёшево.
    while (imported + failed < PER_RUN) {
        const res = await fetch(`${url}/api/v5/files?apiKey=${key}&limit=${PAGE}&page=${page}`);
        if (!res.ok) {
            console.error('[crm-files] список не отдался:', res.status);
            break;
        }
        const payload: any = await res.json();
        totalPages = payload?.pagination?.totalPageCount ?? page;
        const files: any[] = payload?.files || [];
        if (!files.length) break;

        for (const file of files) {
            if (imported + failed >= PER_RUN) break;

            // Файл интересен, только если он привязан к заказу: номер заказа —
            // наш ключ в `order_files`.
            if (done.has(String(file.id))) { skipped += 1; continue; }

            const orderId = (file.attachment || []).map((a: any) => a?.order?.id).find(Boolean);
            if (!orderId) { skipped += 1; continue; }

            const { data: order } = await supabase
                .from('orders')
                .select('number')
                .eq('order_id', orderId)
                .maybeSingle();
            const orderNumber = order?.number ? String(order.number) : null;
            if (!orderNumber) { skipped += 1; continue; }

            // Номер заказа в пути тоже латиницей: у своих заказов он с кириллической «А».
            const storagePath = `order-files/${safeStorageSegment(orderNumber, 40)}/retailcrm/${file.id}-${safeStorageSegment(file.filename)}`;

            if (Number(file.size) > MAX_BYTES) { skipped += 1; continue; }

            try {
                const bin = await fetch(`${url}/api/v5/files/${file.id}/download?apiKey=${key}`);
                if (!bin.ok) { failed += 1; continue; }
                const buffer = Buffer.from(await bin.arrayBuffer());

                const upload = await supabase.storage.from(BUCKET).upload(storagePath, buffer, {
                    contentType: file.type || 'application/octet-stream',
                    upsert: true,
                });
                if (upload.error) { failed += 1; continue; }

                await supabase.from('order_files').insert({
                    order_number: orderNumber,
                    file_name: file.filename,
                    content_type: file.type || null,
                    size_bytes: buffer.length,
                    storage_bucket: BUCKET,
                    storage_path: storagePath,
                    uploaded_by: 'Перенесено из RetailCRM',
                    note: `Файл заказа из RetailCRM от ${String(file.createdAt || '').slice(0, 10)}`,
                });
                imported += 1;
            } catch (e: any) {
                console.error('[crm-files] файл не перенёсся:', file.id, e?.message || e);
                failed += 1;
            }
        }

        if (page >= totalPages) break;
        page += 1;
    }

    await supabase.from('sync_state').upsert({
        key: PROGRESS_KEY,
        // Страницу, на которой остановились, перечитываем ещё раз: на ней могли
        // остаться необработанные файлы.
        value: String(page),
        updated_at: new Date().toISOString(),
    });

    return NextResponse.json({
        ok: true,
        imported,
        skipped,
        failed,
        page,
        totalPages,
        // Следующий заход начинать с этой страницы.
        nextPage: page >= totalPages ? null : page,
    });
}
