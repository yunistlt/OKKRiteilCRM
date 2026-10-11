/**
 * Адрес файла заказа — в одном месте.
 *
 * Адрес собирали четыре экрана, и два из них звали параметр `filename`, а
 * маршрут ждёт `name`. Имя не доезжало, маршрут отвечал ошибкой, и в окне
 * просмотра был знак вопроса вместо картинки (жалоба 11.10.2026). Теперь
 * адрес строит одна функция, и разойтись им негде.
 */

export type OrderFileRef =
    /** Файл заказа: загружен руками или собран нами. */
    | { orderNumber: string | number; fileId: string | number }
    /** Вложение письма: берётся из ящика по письму и имени файла. */
    | { orderNumber: string | number; emailId: string | number; name: string };

export function orderFileHref(ref: OrderFileRef): string {
    const order = encodeURIComponent(String(ref.orderNumber));

    if ('fileId' in ref) {
        return `/api/orders/${order}/files/download?fileId=${encodeURIComponent(String(ref.fileId))}`;
    }

    return `/api/orders/${order}/files/download`
        + `?emailId=${encodeURIComponent(String(ref.emailId))}`
        + `&name=${encodeURIComponent(ref.name)}`;
}
