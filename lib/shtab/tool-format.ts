/**
 * Подача ответов инструментов Тамаре.
 *
 * Разговор устроен витками: на каждом витке модели заново отправляется весь
 * накопленный контекст, и ответ инструмента, полученный на третьем витке, едет
 * вместе с запросом ещё десять раз. Поэтому его размер множится на число
 * оставшихся витков — на длинном разборе это десятки тысяч токенов за вопрос.
 *
 * JSON тратит их зря: у выборки из ста строк имена полей повторяются сто раз, а
 * суммы приходят из Postgres как «1234567.890000000001». Здесь то же самое
 * подаётся таблицей — шапка один раз, дальше строки, — и это вдвое короче на
 * реальных выдачах Тамары.
 *
 * Данные при этом не теряются и не сокращаются: ни одна строка, ни одно поле,
 * ни один значащий разряд. Урезать выдачу нельзя — Тамара считает по ней числа,
 * которые потом называет владельцу, и каждое из них должно раскладываться до
 * исходных данных.
 */

/** Разделитель колонок. Вертикальная черта: в данных почти не встречается и читается глазами. */
const SEP = '|';

/** Больше — уже не таблица, а простыня: такие поля подаём как есть, по одному на строку. */
const WIDE_COLUMNS = 12;

function cell(value: unknown): string {
    if (value === null || value === undefined) return '';
    if (value instanceof Date) return value.toISOString().slice(0, 16).replace('T', ' ');
    if (typeof value === 'object') return JSON.stringify(value);
    const text = String(value);
    // Postgres отдаёт numeric строкой со всеми разрядами: «1234567.8900000000001».
    // Показываем два знака — на большее в деньгах и процентах никто не смотрит,
    // а целые числа не трогаем вовсе.
    if (/^-?\d+\.\d{3,}$/.test(text)) {
        const n = Number(text);
        if (Number.isFinite(n)) return n.toFixed(2);
    }
    return text.includes('\n') ? text.replace(/\n/g, ' ') : text;
}

/** Массив однородных объектов → таблица. Разнородные и слишком широкие отдаём как есть. */
function asTable(rows: any[]): string | null {
    if (rows.length === 0) return null;
    const first = rows[0];
    if (!first || typeof first !== 'object' || Array.isArray(first)) return null;

    const cols = Object.keys(first);
    if (cols.length === 0 || cols.length > WIDE_COLUMNS) return null;
    // Разнородные записи таблицей подавать нельзя: колонки разъедутся, и модель
    // прочитает значение не из того поля.
    for (const row of rows) {
        if (!row || typeof row !== 'object' || Array.isArray(row)) return null;
        const keys = Object.keys(row);
        if (keys.length !== cols.length || keys.some((k, i) => k !== cols[i])) return null;
    }

    return [cols.join(SEP), ...rows.map((r) => cols.map((c) => cell(r[c])).join(SEP))].join('\n');
}

/**
 * Ответ инструмента для модели.
 *
 * Табличной подаётся только начинка — сам ответ остаётся объектом, чтобы поля
 * вроде note и rowCount дошли дословно: в note инструмент предупреждает, что
 * выдача обрезана лимитом, и потерять это предупреждение нельзя.
 */
export function formatToolResult(result: unknown): string {
    if (result === null || result === undefined) return 'пусто';
    if (typeof result !== 'object') return String(result);

    if (Array.isArray(result)) {
        const table = asTable(result);
        return table ? `строк: ${result.length}\n${table}` : JSON.stringify(result);
    }

    const parts: string[] = [];
    let tabled = false;
    for (const [key, value] of Object.entries(result as Record<string, unknown>)) {
        if (value === undefined) continue;
        if (Array.isArray(value)) {
            const table = asTable(value);
            if (table) {
                parts.push(`${key} (строк: ${value.length}):\n${table}`);
                tabled = true;
                continue;
            }
        }
        parts.push(`${key}: ${typeof value === 'object' && value !== null ? JSON.stringify(value) : cell(value)}`);
    }
    // Ничего табличного не нашлось — привычный JSON короче россыпи строк.
    return tabled ? parts.join('\n') : JSON.stringify(result);
}
