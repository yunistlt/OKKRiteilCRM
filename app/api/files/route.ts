/**
 * Все файлы базы одним списком — для раздела «Файлы» в левом меню.
 *
 * Женя Матвеева 12.10.2026 искала паспорт на шкаф ШСО-22М: файл есть, но лежит
 * в чужом заказе, и найти его можно было, только помня номер. Поиск внутри
 * карточки заказа это закрывал наполовину — владелец попросил вынести файлы
 * отдельным разделом, где видно всё и ищется по названию.
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

export async function GET(req: Request) {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: 'Неавторизован' }, { status: 401 });

    const params = new URL(req.url).searchParams;
    const query = String(params.get('q') ?? '').trim();
    const page = Math.max(1, Number(params.get('page') ?? 1) || 1);
    const requested = Number(params.get('pageSize') ?? 50) || 50;
    const pageSize = PAGE_SIZES.includes(requested) ? requested : 50;
    const from = (page - 1) * pageSize;

    let request = supabase
        .from('order_files')
        .select('id, order_number, file_name, content_type, size_bytes, uploaded_by, note, for_production, created_at', { count: 'exact' })
        .is('deleted_at', null);

    if (query) {
        // Запятые и скобки ломают фильтр PostgREST — выкидываем их из поиска.
        const safe = query.replace(/[%,()]/g, ' ').trim();
        if (safe) {
            // Ищем и по названию файла, и по номеру заказа: человек набирает
            // то, что помнит.
            request = request.or(`file_name.ilike.%${safe}%,order_number.ilike.%${safe}%`);
        }
    }

    const { data, error, count } = await request
        .order('created_at', { ascending: false })
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

    return NextResponse.json({ files, total: count ?? 0, page, pageSize });
}
