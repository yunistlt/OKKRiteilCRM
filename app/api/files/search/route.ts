/**
 * Поиск файла по названию во всех заказах.
 *
 * Женя Матвеева 12.10.2026: «мне нужен паспорт на шкаф ШСО-22М… он точно есть у
 * меня в заказах, но в ОКК найти не могу». Файлы на месте — все десять
 * паспортов ШСО-22М у нас есть, — но лежат каждый в своём заказе, и дотянуться
 * до них можно было, только помня номер.
 *
 * Поэтому ищем по имени файла сразу по всем заказам: менеджеру нужен паспорт
 * изделия, а не файл конкретного заказа.
 */
import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { supabase } from '@/utils/supabase';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: 'Неавторизован' }, { status: 401 });

    const query = String(new URL(req.url).searchParams.get('q') ?? '').trim();
    if (query.length < 3) {
        return NextResponse.json({ files: [], hint: 'Введите хотя бы три буквы названия' });
    }

    // Запятые и скобки ломают фильтр PostgREST — выкидываем их из поиска.
    const safe = query.replace(/[%,()]/g, ' ').trim();

    const { data, error } = await supabase
        .from('order_files')
        .select('id, order_number, file_name, size_bytes, created_at')
        .ilike('file_name', `%${safe}%`)
        .is('deleted_at', null)
        .order('created_at', { ascending: false })
        .limit(40);

    if (error) {
        console.error('[file-search] не искалось:', error.message);
        return NextResponse.json({ error: 'Поиск не отработал' }, { status: 500 });
    }

    /**
     * Один и тот же паспорт прикладывают к десятку заказов. Показываем каждое
     * имя один раз — с самым свежим заказом: человеку нужен файл, а не список
     * его копий.
     */
    const seen = new Set<string>();
    const files = ((data ?? []) as any[])
        .filter((row) => {
            const key = String(row.file_name).toLowerCase();
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        })
        .map((row) => ({
            id: row.id,
            orderNumber: String(row.order_number),
            name: row.file_name,
            size: row.size_bytes ?? null,
            at: row.created_at,
        }));

    return NextResponse.json({ files });
}
