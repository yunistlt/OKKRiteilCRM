/**
 * Проверка номера заказа для ЦехУспеха.
 *
 * Нужна для привязки заказа, который завели в ЦехУспехе руками: прежде чем показать в его карточке
 * переход в ОКК, ЦехУспех спрашивает у нас, существует ли такой заказ. Иначе в карточке появилась
 * бы ссылка в никуда.
 *
 * Отдаём МИНИМУМ: номер и заказчика, чтобы человек по названию убедился, что связывает тот заказ.
 * Ни сумм, ни состава — для этого есть страница просмотра по подписанной ссылке.
 */
import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/utils/supabase';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest, { params }: { params: { number: string } }) {
    const key = process.env.TSEH_API_KEY;
    const given = req.headers.get('x-api-key');
    // Ключа нет в окружении — связь не настроена, и «пускаем всех» тут недопустимо.
    if (!key || !given || given !== key) {
        return NextResponse.json({ error: 'Доступ запрещён' }, { status: 401 });
    }

    const number = decodeURIComponent(params.number);
    const { data } = await supabase
        .from('orders')
        .select('number, raw_payload')
        .eq('number', number)
        .maybeSingle();

    if (!data) return NextResponse.json({ error: 'Заказ не найден' }, { status: 404 });

    const payload = (data as any).raw_payload || {};
    return NextResponse.json({
        number: (data as any).number,
        customer: payload.contragent?.legalName || payload.customer?.nickName || null,
    });
}
