/**
 * Заказы по номеру телефона — чтобы спросить заказ ДО набора.
 *
 * Решение владельца 15.10.2026. Разбор звонка 07.10.2026 на +79787129992:
 * менеджер набрала из списка звонков, номер заказа при наборе не назвали, и
 * привязки не случилось — хотя телефон принадлежит ровно одному заказу 39775.
 * Привязка приходит ВМЕСТЕ с набором (закон 05.10.2026 «мы ничего не матчим»),
 * значит спрашивать заказ надо до того, как пошёл гудок.
 *
 * Владелец предлагал запретить набор вне карточки заказа. Запрет сделал бы
 * хуже: кнопки в ОКК пропали бы, а телефон на столе и мобильный остались, —
 * звонок ушёл бы вообще мимо учёта, без записи и расшифровки. Поэтому не
 * запрет, а невозможность набрать «в никуда».
 *
 * Своего поиска заказов здесь нет: он один на всю систему — `ordersByPhone`
 * в `lib/call-binding.ts` (ЗАКОН «один источник правды»).
 */
import { NextResponse } from 'next/server';
import { statusNamesByCode } from '@/lib/own-crm/status-code';
import { getSession } from '@/lib/auth';
import { supabase } from '@/utils/supabase';
import { ordersByPhone } from '@/lib/call-binding';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: 'Неавторизован' }, { status: 401 });

    const phone = new URL(request.url).searchParams.get('phone')?.trim() || '';
    if (phone.replace(/\D/g, '').length < 6) {
        return NextResponse.json({ error: 'Не указан номер' }, { status: 400 });
    }

    const orders = await ordersByPhone(phone, 20).catch(() => []);

    // Статус человеку — названием, а не кодом (ЗАКОН «только человеческий язык»).
    const codes = Array.from(new Set(orders.map((order) => order.status).filter(Boolean) as string[]));
    const names = await statusNamesByCode(codes);

    return NextResponse.json({
        phone,
        orders: orders.map((order) => ({
            orderId: order.orderId,
            number: order.number,
            // Нет человеческого названия — не показываем ничего: код статуса
            // («cancel-other») человеку ничего не говорит (ЗАКОН «только
            // человеческий язык»).
            status: order.status ? (names.get(order.status) ?? null) : null,
        })),
    });
}
