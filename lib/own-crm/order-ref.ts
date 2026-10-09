import { supabase } from '@/utils/supabase';

/**
 * Заказ по тому, что пришло в адрес маршрута: номеру или идентификатору.
 *
 * Код писался, когда номер заказа РАВЕН его `order_id` — так устроена
 * RetailCRM. Свои заказы нумеруются 900118, а их `order_id` = 900000118, и
 * каждое место, где номер подставляли как id, тихо перестало находить заказ.
 * За два дня это всплыло трижды: предпросмотр КП, поиск переписки и звонки в
 * карточке качества (жалобы менеджеров 08–09.10.2026).
 *
 * Одно место на весь проект. Порядок один и тот же везде: СНАЧАЛА по номеру,
 * потом считаем, что пришёл идентификатор. Иначе у своих заказов номер —
 * тоже число, и проверка «число значит id» снова промахнётся.
 */
export type OrderRef = {
    /** `orders.id` — он же первичный ключ строки. */
    id: number;
    /** `orders.order_id` — идентификатор заказа, по нему живут связи. */
    orderId: number;
    /** Человеческий номер: «54905», «900118». */
    number: string;
};

export async function resolveOrderRef(raw: unknown): Promise<OrderRef | null> {
    const value = String(raw ?? '').trim();
    if (!value) return null;

    const byNumber = await supabase
        .from('orders')
        .select('id, order_id, number')
        .eq('number', value)
        .maybeSingle();

    const found = (byNumber.data as any)
        ?? (/^\d+$/.test(value)
            ? (await supabase
                .from('orders')
                .select('id, order_id, number')
                .eq('order_id', Number(value))
                .maybeSingle()).data as any
            : null);

    if (!found) return null;

    return {
        id: Number(found.id),
        orderId: Number(found.order_id ?? found.id),
        number: String(found.number ?? found.order_id ?? found.id),
    };
}
