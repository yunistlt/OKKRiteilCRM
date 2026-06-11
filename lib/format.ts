/**
 * Форматирование чисел для интерфейса.
 *
 * ЗАКОН (см. golds/GOLD_UI_TABLES.md и golds/GOLD_DESIGN_UX.md):
 * все суммы и количества (любое большое число ≥ 1000) отображаются с
 * разделителями разрядов (неразрывный пробел: «20 000 000»). Исключения —
 * идентификаторы (ID заказа), годы, номера телефонов, проценты: они
 * НЕ форматируются разделителями (для них тут отдельных хелперов нет —
 * выводите как есть).
 *
 * Локаль 'ru-RU' даёт в качестве разделителя разрядов узкий неразрывный
 * пробель (U+00A0 / U+202F), что и требуется по дизайну.
 */

/** Разделитель разрядов для чисел (например, «20 000 000»). Пустое/нечисловое → ''. */
export function formatNumberRu(
    value: number | string | null | undefined,
    opts?: { maximumFractionDigits?: number; minimumFractionDigits?: number },
): string {
    if (value === null || value === undefined || value === '') return '';
    const n = typeof value === 'string' ? Number(value) : value;
    if (!Number.isFinite(n)) return '';
    return n.toLocaleString('ru-RU', {
        maximumFractionDigits: opts?.maximumFractionDigits ?? 2,
        minimumFractionDigits: opts?.minimumFractionDigits ?? 0,
    });
}

/** Целое число с разделителями разрядов (округляет). Пустое/нечисловое → ''. */
export function formatIntRu(value: number | string | null | undefined): string {
    if (value === null || value === undefined || value === '') return '';
    const n = typeof value === 'string' ? Number(value) : value;
    if (!Number.isFinite(n)) return '';
    return Math.round(n).toLocaleString('ru-RU');
}

/** Сумма в рублях: «20 000 000 ₽» (целые рубли). */
export function formatRub(value: number | string | null | undefined): string {
    if (value === null || value === undefined || value === '') return '';
    const n = typeof value === 'string' ? Number(value) : value;
    if (!Number.isFinite(n)) return '';
    return `${Math.round(n).toLocaleString('ru-RU')} ₽`;
}

/**
 * Парсит строку, введённую пользователем (с пробелами-разделителями, неразрывными
 * пробелами и запятой как десятичным разделителем), в число. Возвращает null,
 * если значение пустое или не парсится.
 */
export function parseNumberRu(input: string): number | null {
    if (input == null) return null;
    const cleaned = String(input)
        .replace(/[\s  ]/g, '') // обычные и неразрывные пробелы
        .replace(',', '.');
    if (cleaned === '' || cleaned === '-' || cleaned === '.') return null;
    const n = Number(cleaned);
    return Number.isFinite(n) ? n : null;
}
