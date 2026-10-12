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
 * Здесь только файлы, приложенные к заказам (`order_files`). Вложения писем у
 * нас не хранятся — они докачиваются из ящика по требованию, поэтому в общем
 * списке их нет и быть не может.
 */
import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { supabase } from '@/utils/supabase';

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

/** Запятые и скобки ломают фильтр PostgREST — выкидываем их из поиска. */
function safeText(value: string) {
    return value.replace(/[%,()]/g, ' ').trim();
}

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

    let request = supabase
        .from('order_files')
        .select('id, order_number, file_name, content_type, size_bytes, uploaded_by, note, for_production, created_at', { count: 'exact' })
        .is('deleted_at', null);

    // Общий поиск сверху: и по названию файла, и по номеру заказа — человек
    // набирает то, что помнит.
    const query = safeText(String(params.get('q') ?? ''));
    if (query) request = request.or(`file_name.ilike.%${query}%,order_number.ilike.%${query}%`);

    // Фильтр по колонке: текстовые — по вхождению.
    for (const key of ['name', 'order', 'uploadedBy', 'note'] as const) {
        const value = safeText(String(params.get(`f_${key}`) ?? ''));
        if (value) request = request.ilike(COLUMNS[key], `%${value}%`);
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

    const files = ((data ?? []) as any[]).map((row) => ({
        id: row.id,
        orderNumber: String(row.order_number),
        name: row.file_name,
        contentType: row.content_type ?? null,
        size: row.size_bytes ?? null,
        uploadedBy: row.uploaded_by ?? null,
        note: row.note ?? null,
        forProduction: Boolean(row.for_production),
        at: row.created_at,
    }));

    return NextResponse.json({ files, total: count ?? 0, page, pageSize, sortable: Object.keys(COLUMNS) });
}
