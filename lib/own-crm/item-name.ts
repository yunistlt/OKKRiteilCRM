/**
 * Название позиции заказа с модификацией.
 *
 * Склейка «товар + модификация» давала «Сушильный шкаф ШС-4/1 (1900х1200х620
 * мм) Сушильный шкаф ШС-4/1 (1900х1200х620 мм)» и «Доставка Доставка»: в
 * каталоге сайта модификация часто названа полным именем товара. Дубль уходил
 * в заказ и дальше во все документы — счёт, договор, спецификацию (замечание
 * владельца 08.10.2026, заказ 900072).
 */
export function itemNameWithVariant(productName: string, variantName: string): string {
    const product = String(productName ?? '').replace(/\s+/g, ' ').trim();
    const variant = String(variantName ?? '').replace(/\s+/g, ' ').trim();

    if (!variant) return product;
    if (!product) return variant;
    // Модификация уже содержит название товара — берём её целиком.
    if (variant.toLowerCase().includes(product.toLowerCase())) return variant;
    if (product.toLowerCase().includes(variant.toLowerCase())) return product;
    return `${product} ${variant}`;
}

/**
 * Схлопнуть название, в котором товар записан дважды подряд: «X X» → «X».
 *
 * Нужно для заказов, заведённых до починки склейки: документы по ним
 * собираются из сохранённого названия.
 */
export function collapseDoubledName(value: string): string {
    const text = String(value ?? '').replace(/\s+/g, ' ').trim();
    if (!text) return text;

    // Ровно две одинаковые половины, разделённые пробелом.
    const half = Math.floor((text.length - 1) / 2);
    const left = text.slice(0, half).trim();
    const right = text.slice(half + 1).trim();
    if (left && left.toLowerCase() === right.toLowerCase()) return left;

    return text;
}
