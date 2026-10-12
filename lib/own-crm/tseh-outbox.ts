/**
 * Передача заказа в производство: кладём его в очередь, ЦехУспех забирает сам.
 *
 * Очередь живёт у нас (`tseh_production_outbox`) — решение владельца
 * 02.10.2026. Так никому не нужна запись в чужую боевую базу: мы пишем у себя,
 * ЦехУспех приходит на чтение и забирает по своему расписанию.
 *
 * Строка появляется один раз на заказ: номер заказа уникален, повторный перевод
 * в производство очередь не задваивает.
 */
import { supabase } from '@/utils/supabase';
import { orderDocumentData } from '@/lib/own-crm/documents';
import { orderInn } from '@/lib/own-crm/inn-gate';
import { productionComment } from '@/lib/own-crm/tseh-production-notes';

export type OutboxResult =
    | { queued: true; alreadyQueued: boolean; warning?: string }
    | { queued: false; reason: string };

/**
 * Позиции, которые производство не опознает: товар не нашёлся в каталоге сайта, значит
 * нет ни кода, ни фото, ни ссылки — технологу придётся подбирать изделие руками, а у
 * одной модели до 10–15 исполнений, и ошибка означает собранный не тот шкаф
 * (письмо ЦехУспеха 12.10.2026).
 *
 * Чаще всего причина простая: товар архивный или в заказе выбран не из каталога. Говорим
 * об этом менеджеру сразу — он поправит привязку, пока заказ ещё у него в руках. Передачу
 * при этом не блокируем: заказ в цех нужен, даже если одну позицию опознают вручную.
 */
function itemsWithoutCode(items: ProductionItem[]): string[] {
    return items.filter((item) => !item.productId).map((item) => item.name);
}

/**
 * ИНН заказчика — 10 цифр у организации, 12 у предпринимателя.
 *
 * ЦехУспех ищет заказчика только по ИНН: завод работает с юрлицами, и дубли по
 * ИНН там запрещены. Без ИНН заказ туда не заведётся, поэтому говорим об этом
 * менеджеру сразу, а не после отказа (согласовано 04.10.2026).
 */
function innProblem(raw: unknown): string | null {
    const digits = String(raw ?? '').replace(/\D/g, '');
    if (digits.length === 10 || digits.length === 12) return null;
    return 'У заказчика нет корректного ИНН. ЗМК работает только с юрлицами — '
        + 'заполните ИНН в карточке клиента и передайте заказ заново.';
}

/**
 * Адрес фото или карточки товара в том виде, в каком его принимает ЦехУспех.
 *
 * Берём только абсолютный `https://` — картинку тянет браузер сотрудника завода, а не
 * сервер, поэтому относительный путь у него не раскроется. Слишком длинный адрес не
 * обрезаем: обрезанная ссылка ведёт в никуда, а пустое поле у них ничего не затирает.
 */
export function tsehUrl(raw: string | null | undefined, maxLength: number): string | null {
    const value = String(raw ?? '').trim();
    if (!value.startsWith('https://')) return null;
    if (value.length > maxLength) return null;
    return value;
}

/** Позиция заказа в том виде, в каком её принимает ЦехУспех. */
export type ProductionItem = {
    name: string;
    quantity: number;
    price: number;
    /** Прямой адрес файла картинки товара, до 255 символов. */
    imageUrl: string | null;
    /** Адрес карточки товара на сайте, до 512 символов. */
    productUrl: string | null;
    /**
     * Код товара в каталоге сайта — постоянный ключ опознания позиции в производстве
     * (просьба ЦехУспеха 12.10.2026). Раньше они выковыривали его из адреса картинки,
     * что ломалось у товаров без фото и сломалось бы при смене хранилища картинок.
     */
    productId: string | null;
};

/**
 * Состав заказа для производства.
 *
 * Собираем тем же кодом, что готовит счёт — чтобы производство видело ровно то, что
 * видит клиент в документах. Фото товара и ссылку на его карточку каталог сайта отдаёт
 * вместе с составом (ТЗ 12.10.2026): в перечне заказа ЦехУспеха рядом с названием
 * позиции показывается миниатюра, по клику открывается сайт.
 *
 * Одно место на двоих: и постановка в очередь, и досылка картинок по уже заведённым
 * заказам (`backfillProductionImages`) считают состав здесь.
 */
export async function productionItems(orderId: number): Promise<ProductionItem[]> {
    const data = await orderDocumentData(orderId, null);
    return (data?.items || []).map((item) => ({
        name: item.name,
        quantity: item.quantity,
        price: item.price,
        imageUrl: tsehUrl(item.image, 255),
        productUrl: tsehUrl(item.url, 512),
        // Код товара на сайте — главный ключ опознания позиции в производстве.
        // Названия у нас и в цехе не совпадают, а исполнений одной модели до 10–15.
        productId: item.productId || null,
    }));
}

/** Кладёт заказ в очередь на производство. Не бросает: сбой не должен ломать смену статуса. */
export async function queueOrderForProduction(orderId: number): Promise<OutboxResult> {
    try {
        const { data: order } = await supabase
            .from('orders')
            .select('order_id, number, manager_id, srok_izgot_edinica, raw_payload')
            .eq('order_id', orderId)
            .maybeSingle();

        if (!order) return { queued: false, reason: 'заказ не найден' };

        const orderNumber = String((order as any).number ?? orderId);

        const { data: exists } = await supabase
            .from('tseh_production_outbox')
            .select('id')
            .eq('order_number', orderNumber)
            .maybeSingle();
        if (exists) return { queued: true, alreadyQueued: true };

        // Состав, заказчик и сроки собираем тем же кодом, что готовит счёт —
        // чтобы производство видело ровно то, что видит клиент в документах.
        const data = await orderDocumentData(Number((order as any).order_id), null);
        const payload: any = (order as any).raw_payload || {};

        let managerName: string | null = data?.managerName ?? null;
        if (!managerName && (order as any).manager_id) {
            const { data: manager } = await supabase
                .from('managers')
                .select('first_name, last_name')
                .eq('id', (order as any).manager_id)
                .maybeSingle();
            managerName = [(manager as any)?.last_name, (manager as any)?.first_name].filter(Boolean).join(' ') || null;
        }

        const items = await productionItems(Number((order as any).order_id));

        // ИНН спрашиваем там же, где его правит менеджер — в карточке клиента.
        const customerInn = (await orderInn(Number((order as any).order_id))) || data?.payerInn || null;
        const problem = innProblem(customerInn);
        if (problem) return { queued: false, reason: problem };

        const { error } = await supabase.from('tseh_production_outbox').insert({
            order_number: orderNumber,
            order_id: Number((order as any).order_id),
            customer_name: data?.payerCompany || data?.payerName || payload.customer?.nickName || null,
            customer_inn: customerInn,
            manager_name: managerName,
            production_days: data?.productionDays ?? null,
            // В каких днях назван срок. Менеджер пишет календарные, а ЦехУспех считал
            // рабочими — на сроке 40 дней это две недели разницы (замечание логистики
            // 06.10.2026). Поле заполняется в карточке с 05.10.2026, у заказов до неё
            // оно пустое, и по умолчанию это календарные дни — как и в карточке.
            production_days_unit: String((order as any).srok_izgot_edinica ?? '').trim() === 'rabochie'
                ? 'rabochie'
                : 'kalendarnye',
            shipping_terms: data?.shippingTerms ?? null,
            // Наше юрлицо: в карточке ЦехУспеха поле «поставщик» оставалось пустым, и
            // производство не видело, на какие реквизиты оплачено.
            seller_name: data?.seller?.name || null,
            seller_inn: data?.seller?.inn || null,
            seller_account: data?.seller?.rs || null,
            seller_bank: data?.seller?.bank || null,
            items: items,
            total_summ: payload.totalSumm ?? null,
            // В цех уходит ТОЛЬКО то, что менеджер написал во вкладке «Для производства»
            // (решение владельца 04.10.2026). Комментарий менеджера по заказу туда больше не
            // передаём: там бывает внутренняя кухня — согласования и договорённости по цене.
            manager_comment: await productionComment(orderNumber),
        });

        if (error) {
            console.error('[tseh-outbox] заказ не встал в очередь:', orderNumber, error);
            return { queued: false, reason: error.message };
        }

        const noCode = itemsWithoutCode(items);
        const warning = noCode.length
            ? `Производство не опознает ${noCode.length} ${noCode.length === 1 ? 'позицию' : 'позиции'}: `
              + `${noCode.slice(0, 3).join('; ')}${noCode.length > 3 ? '…' : ''}. `
              + 'Товара нет в каталоге сайта — технолог будет подбирать изделие вручную. '
              + 'Проверьте, что в заказе выбран товар из каталога, а не архивный.'
            : undefined;

        return { queued: true, alreadyQueued: false, warning };
    } catch (e: any) {
        console.error('[tseh-outbox] ошибка постановки в очередь:', e?.message || e);
        return { queued: false, reason: String(e?.message || e) };
    }
}
