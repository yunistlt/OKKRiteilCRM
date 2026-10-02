/**
 * Скидки в заказе — по правилам RetailCRM, чтобы цифры совпадали один в один.
 *
 * Видов скидки у них три, и они складываются:
 *  1. у позиции — абсолютная, рублями НА ЕДИНИЦУ (`discountManualAmount`);
 *  2. у позиции — процентом от её цены (`discountManualPercent`);
 *  3. у заказа — «Разовая скидка», рублями и/или процентом
 *     (`discountManualAmount` / `discountManualPercent` самого заказа),
 *     процент считается от стоимости товаров уже со скидками позиций.
 *
 * Поэтому «скидка» в карточке — это не одно число: считаем здесь, в одном
 * месте, и этим же считаем итог, печатные документы и то, что уходит наружу.
 * Решение владельца 02.10.2026: ставить скидку у нас так же, как в RetailCRM.
 */

export type DiscountableItem = {
    quantity: number;
    /** Базовая цена за единицу, до скидок. */
    price: number;
    /** Скидка рублями на единицу. */
    discountAmount?: number | null;
    /** Скидка процентом от цены единицы. */
    discountPercent?: number | null;
};

export type OrderDiscount = {
    /** Разовая скидка на заказ, рублями. */
    discountAmount?: number | null;
    /** Разовая скидка на заказ, процентом от стоимости товаров. */
    discountPercent?: number | null;
};

export type OrderTotals = {
    /** Стоимость товаров по базовым ценам. */
    itemsGross: number;
    /** Скидки по позициям, в рублях. */
    itemsDiscount: number;
    /** Разовая скидка на заказ, в рублях. */
    orderDiscount: number;
    /** Все скидки вместе — строка «Сумма скидок по заказу». */
    discountTotal: number;
    deliveryCost: number;
    /** Итого к оплате. */
    total: number;
};

const num = (value: unknown): number => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
};

/** Копейки: иначе процент даёт хвост в 0,000000001 и ломает сверку с CRM. */
export function roundMoney(value: number): number {
    return Math.round(value * 100) / 100;
}

/**
 * Скидка на ЕДИНИЦУ товара в рублях: рубли и процент складываются, как у них.
 * Больше цены скидка быть не может — ниже нуля цена не уходит.
 */
export function itemDiscountPerUnit(item: DiscountableItem): number {
    const price = Math.max(0, num(item.price));
    const byAmount = Math.max(0, num(item.discountAmount));
    const byPercent = (price * Math.min(100, Math.max(0, num(item.discountPercent)))) / 100;
    return roundMoney(Math.min(price, byAmount + byPercent));
}

/** Цена за единицу со скидкой — та, что RetailCRM держит в `items[].price`. */
export function itemPriceWithDiscount(item: DiscountableItem): number {
    return roundMoney(Math.max(0, num(item.price) - itemDiscountPerUnit(item)));
}

/** Стоимость позиции со скидкой. */
export function itemTotalWithDiscount(item: DiscountableItem): number {
    return roundMoney(itemPriceWithDiscount(item) * Math.max(0, num(item.quantity)));
}

/**
 * Итоги заказа: стоимость товаров, скидки по отдельности и итог.
 *
 * Порядок важен и повторяет RetailCRM: сначала скидки позиций, потом разовая
 * скидка от получившейся стоимости товаров, и только в конце доставка —
 * на доставку скидка не распространяется.
 */
export function orderTotals(
    items: DiscountableItem[],
    options: OrderDiscount & { deliveryCost?: number | null } = {},
): OrderTotals {
    const list = Array.isArray(items) ? items : [];

    const itemsGross = roundMoney(
        list.reduce((sum, item) => sum + Math.max(0, num(item.price)) * Math.max(0, num(item.quantity)), 0),
    );
    const itemsNet = roundMoney(list.reduce((sum, item) => sum + itemTotalWithDiscount(item), 0));
    const itemsDiscount = roundMoney(itemsGross - itemsNet);

    const byAmount = Math.max(0, num(options.discountAmount));
    const byPercent = (itemsNet * Math.min(100, Math.max(0, num(options.discountPercent)))) / 100;
    const orderDiscount = roundMoney(Math.min(itemsNet, byAmount + byPercent));

    const deliveryCost = roundMoney(Math.max(0, num(options.deliveryCost)));

    return {
        itemsGross,
        itemsDiscount,
        orderDiscount,
        discountTotal: roundMoney(itemsDiscount + orderDiscount),
        deliveryCost,
        total: roundMoney(itemsNet - orderDiscount + deliveryCost),
    };
}
