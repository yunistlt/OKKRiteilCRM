/**
 * «Загрузить историю» по заказу: поднять из почтового ящика переписку с
 * клиентом, которая старше нашего архива (он начинается с 28.06.2026).
 *
 * Решение владельца 22.10.2026 по доработке №34: «надо сделать кнопку
 * ЗАГРУЗИТЬ ИСТОРИЮ и чтобы они могли точечно по сделке загружать».
 * Разбор всего ящика назад не делаем — только по адресам этого клиента.
 */
import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { supabase } from '@/utils/supabase';
import { importOrderMailHistory } from '@/lib/email/history-import';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
    const session = await getSession();
    if (!session?.user) return NextResponse.json({ error: 'Неавторизован' }, { status: 401 });

    const { id } = await params;
    const orderNumber = decodeURIComponent(String(id)).trim();

    // Номер заказа — не идентификатор (900089 против 900000089): ищем по номеру.
    const { data: order } = await supabase
        .from('orders')
        .select('order_id')
        .eq('number', orderNumber)
        .maybeSingle();

    if (!order) return NextResponse.json({ error: 'Заказ не найден' }, { status: 404 });

    const result = await importOrderMailHistory({
        orderNumber,
        orderId: (order as any).order_id ?? null,
    });

    if (!result.ok) {
        return NextResponse.json({ error: result.error || 'Историю поднять не удалось' }, { status: 409 });
    }

    const added = result.addedIncoming + result.addedOutgoing;
    return NextResponse.json({
        ...result,
        ok: true,
        // Человеческим языком — это уходит прямо в интерфейс.
        message: added > 0
            ? `Подняли ${added} писем из почты (входящих ${result.addedIncoming}, отправленных ${result.addedOutgoing}).`
            : result.found > 0
                ? 'Вся переписка с этим клиентом уже есть в заказе.'
                : `Писем с адресами клиента (${result.addresses.join(', ')}) в ящике не нашлось.`,
    });
}
