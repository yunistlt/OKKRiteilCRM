/**
 * Все файлы базы одним списком — для раздела «Файлы» в левом меню.
 *
 * Женя Матвеева 12.10.2026 искала паспорт на шкаф ШСО-22М: файл есть, но лежит
 * в чужом заказе, и найти его можно было, только помня номер. Поиск внутри
 * карточки заказа это закрывал наполовину — владелец попросил вынести файлы
 * отдельным разделом, где видно всё и ищется по названию.
 *
 * Фильтр — по каждой колонке отдельно (золотой стандарт таблиц, §5) и порядок
 * строк по любой колонке. Считает всё база: на 33 тысячах строк отбирать на
 * клиенте нечего — он видит только свою страницу.
 *
 * Файлы приходят из двух мест, и человеку об этом знать незачем (Андрей
 * 14.10.2026: «менеджерам не важно, где лежат — в ЦУ или в ОКК, для них это
 * один источник»): файлы заказов лежат у нас в `order_files`, а паспорта и
 * инструкции на продукцию — в базе завода, и читаются оттуда живьём, чтобы
 * версия всегда совпадала с цеховой.
 *
 * Документы завода подмешиваются только в поиск: показать их «все подряд»
 * значит выкачивать чужую боевую базу на каждое открытие раздела.
 *
 * Вложения писем у нас не хранятся — они докачиваются из ящика по требованию,
 * поэтому в общем списке их нет и быть не может.
 */
import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { supabase } from '@/utils/supabase';
import { allWordsIlike, anyColumnAllWords, searchWords } from '@/lib/search-words';
import { externalDbConfigured } from '@/lib/shtab/external/client';
import { searchProductDocs } from '@/lib/product-docs/search';

export const dynamic = 'force-dynamic';

const PAGE_SIZES = [20, 50, 100];

/** Колонка таблицы → поле в базе. Сортируем и фильтруем только по ним. */
const COLUMNS = {
    name: 'file_name',
    order: 'order_number',
    size: 'size_bytes',
    uploadedBy: 'uploaded_by',
    at: 'created_at',
    note: 'note',
} as const;

export async function GET(req: Request) {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: 'Неавторизован' }, { status: 401 });

    const params = new URL(req.url).searchParams;
    const page = Math.max(1, Number(params.get('page') ?? 1) || 1);
    const requested = Number(params.get('pageSize') ?? 50) || 50;
    const pageSize = PAGE_SIZES.includes(requested) ? requested : 50;
    const from = (page - 1) * pageSize;

    const sortKey = (params.get('sort') ?? 'at') as keyof typeof COLUMNS;
    const sortColumn = COLUMNS[sortKey] ?? COLUMNS.at;
    const ascending = params.get('dir') === 'asc';

    /**
     * Архивные показываем по требованию.
     *
     * Удалять файлы нельзя — их только помечают архивными (ЗАКОН владельца
     * 12.10.2026), поэтому архив должен быть виден и открываться, а не
     * пропадать из системы.
     */
    const archive = params.get('archive') === '1';

    let request = supabase
        .from('order_files')
        .select('id, order_number, file_name, content_type, size_bytes, uploaded_by, note, for_production, created_at, archived_at, archived_by, deleted_at', { count: 'exact' });

    if (archive) {
        // В архиве показываем и то, что удаляли до введения правила: сам файл
        // оттуда уже стёрт, но след остаётся — видно, что он был.
        request = request.or('archived_at.not.is.null,deleted_at.not.is.null');
    } else {
        request = request.is('deleted_at', null).is('archived_at', null);
    }

    // Общий поиск сверху: и по названию файла, и по номеру заказа — человек
    // набирает то, что помнит. Слова ищутся все и в любом порядке: «паспорт SL»
    // должен находить «Паспорт_Сушильный_стеллаж_SL1_Вираж_16».
    const words = searchWords(String(params.get('q') ?? ''));
    if (words.length) request = request.or(anyColumnAllWords(['file_name', 'order_number'], words));

    // Фильтр по колонке: текстовые — по тем же словам, только в своей колонке.
    for (const key of ['name', 'order', 'uploadedBy', 'note'] as const) {
        const columnWords = searchWords(String(params.get(`f_${key}`) ?? ''));
        if (columnWords.length) request = request.or(`and(${allWordsIlike(COLUMNS[key], columnWords)})`);
    }

    // Размер — «от» и «до» в килобайтах: человек думает килобайтами, база
    // хранит байты.
    const sizeFrom = Number(params.get('f_sizeFrom'));
    const sizeTo = Number(params.get('f_sizeTo'));
    if (Number.isFinite(sizeFrom) && sizeFrom > 0) request = request.gte('size_bytes', Math.round(sizeFrom * 1024));
    if (Number.isFinite(sizeTo) && sizeTo > 0) request = request.lte('size_bytes', Math.round(sizeTo * 1024));

    // Дата — «с» и «по» включительно: «по 12.10» означает весь день 12-го.
    const dateFrom = String(params.get('f_dateFrom') ?? '').trim();
    const dateTo = String(params.get('f_dateTo') ?? '').trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(dateFrom)) request = request.gte('created_at', `${dateFrom}T00:00:00`);
    if (/^\d{4}-\d{2}-\d{2}$/.test(dateTo)) request = request.lte('created_at', `${dateTo}T23:59:59.999`);

    const { data, error, count } = await request
        .order(sortColumn, { ascending, nullsFirst: false })
        .range(from, from + pageSize - 1);

    if (error) {
        console.error('[files] список не собрался:', error.message);
        return NextResponse.json({ error: 'Список файлов не собрался' }, { status: 500 });
    }

    const ourFiles = ((data ?? []) as any[]).map((row) => ({
        id: row.id,
        orderNumber: String(row.order_number),
        name: row.file_name,
        contentType: row.content_type ?? null,
        size: row.size_bytes ?? null,
        uploadedBy: row.uploaded_by ?? null,
        note: row.note ?? null,
        forProduction: Boolean(row.for_production),
        at: row.created_at,
        archivedAt: row.archived_at ?? row.deleted_at ?? null,
        archivedBy: row.archived_by ?? null,
        /** Файл стёрли до закона 12.10.2026 — открыть его уже нельзя. */
        lost: Boolean(row.deleted_at),
    }));

    /**
     * Паспорта и инструкции с завода. Они не принадлежат заказу, поэтому
     * показываются только когда человек ищет, и только на первой странице: это
     * ответ на запрос, а не часть ленты.
     */
    let plant: any[] = [];
    if (words.length && page === 1 && !archive && externalDbConfigured('tseh')) {
        try {
            const docs = await searchProductDocs({ query: String(params.get('q') ?? ''), kind: 'docs', limit: 40 });
            plant = docs.map((doc) => ({
                id: `tseh-${doc.source}-${doc.fileId}`,
                orderNumber: null,
                name: doc.fileName,
                contentType: null,
                // Размер нарочно не считаем: ради него база завода прочитала бы
                // все документы целиком, и поиск занимал бы полторы минуты.
                size: null,
                uploadedBy: null,
                note: doc.ownerName,
                forProduction: false,
                at: doc.changedAt,
                archivedAt: null,
                archivedBy: null,
                lost: false,
                href: `/api/product-docs/file/${encodeURIComponent(doc.fileName || 'Документ')}?source=${doc.source}&id=${doc.fileId}`,
            }));
        } catch (plantError) {
            // База завода недоступна — показываем свои файлы и молчим: раздел
            // продолжает работать, а чинить связь всё равно не менеджеру.
            console.error('[files] документы завода не прочитались:', plantError);
        }
    }

    const files = [...plant, ...ourFiles];

    return NextResponse.json({
        files,
        total: (count ?? 0) + plant.length,
        page,
        pageSize,
        sortable: Object.keys(COLUMNS),
    });
}
