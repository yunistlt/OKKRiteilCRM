/**
 * Содержимое одного файла заказа для ЦехУспеха.
 *
 * Отдаём только файл, отмеченный менеджером «для производства», и только у заказа из адреса:
 * иначе по идентификатору можно было бы вытащить любой документ любого заказа.
 */
import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/utils/supabase';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest, { params }: { params: { number: string; id: string } }) {
    const key = process.env.TSEH_API_KEY;
    const given = req.headers.get('x-api-key');
    if (!key || !given || given !== key) {
        return NextResponse.json({ error: 'Доступ запрещён' }, { status: 401 });
    }

    const number = decodeURIComponent(params.number);
    const id = Number(params.id);
    if (!Number.isFinite(id)) return NextResponse.json({ error: 'Файл не найден' }, { status: 404 });

    // Номер заказа и отметка — в условии, а не в проверке после выборки: так чужой файл
    // не отдаётся даже при опечатке в идентификаторе.
    const { data } = await supabase
        .from('order_files')
        .select('file_name, content_type, storage_bucket, storage_path')
        .eq('id', id)
        .eq('order_number', number)
        .eq('for_production', true)
        .is('deleted_at', null)
        .maybeSingle();

    if (!data) return NextResponse.json({ error: 'Файл не найден' }, { status: 404 });

    const row = data as any;
    const file = await supabase.storage.from(String(row.storage_bucket)).download(String(row.storage_path));
    if (file.error || !file.data) {
        return NextResponse.json({ error: 'Файл не читается: ' + (file.error?.message || 'нет содержимого') }, { status: 502 });
    }

    const bytes = Buffer.from(await file.data.arrayBuffer());
    return new NextResponse(bytes, {
        status: 200,
        headers: {
            'Content-Type': String(row.content_type || 'application/octet-stream'),
            'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(String(row.file_name || 'file'))}`,
            'Cache-Control': 'no-store',
        },
    });
}
