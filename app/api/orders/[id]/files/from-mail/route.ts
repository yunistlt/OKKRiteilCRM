/**
 * «Забрать файлы из почты» по заказу: вложения всех писем с тегом `[#N/<номер>]`
 * в теме ложатся в файлы заказа.
 *
 * Нужно старым сделкам: там счета, КП и сертификаты жили только в письмах, а
 * RetailCRM такие вложения в API не отдаёт (проверка по заказу 52709
 * 26.10.2026: в окне файлов восемь, в API два).
 */
import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { supabase } from '@/utils/supabase';
import { importOrderFilesFromMail } from '@/lib/email/order-files-from-mail';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
    const session = await getSession();
    if (!session?.user) return NextResponse.json({ error: 'Неавторизован' }, { status: 401 });

    const { id } = await params;
    // Номер своего заказа бывает с кириллической «А» — в адресе он закодирован.
    const orderNumber = decodeURIComponent(String(id)).trim();

    const { data: order } = await supabase
        .from('orders')
        .select('number')
        .eq('number', orderNumber)
        .maybeSingle();

    if (!order) return NextResponse.json({ error: 'Заказ не найден' }, { status: 404 });

    const result = await importOrderFilesFromMail(orderNumber);

    if (!result.ok) {
        return NextResponse.json({ error: result.error || 'Файлы из почты забрать не удалось' }, { status: 409 });
    }

    return NextResponse.json({
        ...result,
        // Человеческим языком — это уходит прямо в интерфейс.
        message: result.added > 0
            ? `Забрали ${result.added} файлов из ${result.letters} писем.`
            : result.letters > 0
                ? 'Все вложения писем уже лежат в заказе.'
                : 'Писем с тегом этого заказа в почте не нашлось.',
    });
}
