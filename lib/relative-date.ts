/**
 * Относительные даты в фильтрах — как в RetailCRM.
 *
 * Менеджер думает не числами, а «неделю назад», «завтра», «через месяц».
 * В RetailCRM такой выбор не превращается в дату навсегда: сохранённый фильтр
 * «Заказы на завтра» завтра означает уже другое число. Поэтому в фильтре
 * хранится само смещение, а в дату оно разворачивается в момент запроса
 * (требование владельца 01.10.2026: «1 в 1 как в ритейле»).
 *
 * Формат значения: `rel:-7d`, `rel:+1m`, `rel:0d` (сегодня). Обычная дата
 * `2026-10-01` остаётся как есть — человек вправе выбрать конкретное число.
 */
export type RelativeUnit = 'd' | 'w' | 'm' | 'y';

const UNIT_NAMES: Record<RelativeUnit, [string, string, string]> = {
    d: ['день', 'дня', 'дней'],
    w: ['неделя', 'недели', 'недель'],
    m: ['месяц', 'месяца', 'месяцев'],
    y: ['год', 'года', 'лет'],
};

const TOKEN = /^rel:([+-])(\d+)([dwmy])$/;

/** Значение фильтра для смещения: `rel:-7d`. */
export function relativeToken(amount: number, unit: RelativeUnit, direction: -1 | 1): string {
    return `rel:${direction < 0 ? '-' : '+'}${Math.max(0, Math.round(amount))}${unit}`;
}

export function isRelative(value: string | null | undefined): boolean {
    return Boolean(value && TOKEN.test(value));
}

/** Разворачивает смещение в дату ГГГГ-ММ-ДД на сегодня. Обычную дату отдаёт как есть. */
export function resolveDate(value: string | null | undefined, today = new Date()): string {
    if (!value) return '';

    const match = TOKEN.exec(value);
    if (!match) return value;

    const [, sign, rawAmount, unit] = match;
    const amount = Number(rawAmount) * (sign === '-' ? -1 : 1);
    const date = new Date(today.getTime());

    if (unit === 'd') date.setDate(date.getDate() + amount);
    if (unit === 'w') date.setDate(date.getDate() + amount * 7);
    if (unit === 'm') date.setMonth(date.getMonth() + amount);
    if (unit === 'y') date.setFullYear(date.getFullYear() + amount);

    // Через местное время: иначе у нас «вчера» на пару часов уезжает в позапрошлый день.
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function plural(amount: number, forms: [string, string, string]): string {
    const n = Math.abs(amount) % 100;
    const n1 = n % 10;
    if (n > 10 && n < 20) return forms[2];
    if (n1 > 1 && n1 < 5) return forms[1];
    if (n1 === 1) return forms[0];
    return forms[2];
}

/** Как смещение называется по-русски: «7 дней назад», «через 1 месяц», «сегодня». */
export function relativeLabel(value: string | null | undefined): string {
    const match = value ? TOKEN.exec(value) : null;
    if (!match) return '';

    const [, sign, rawAmount, unit] = match;
    const amount = Number(rawAmount);

    if (amount === 0) return 'сегодня';

    const word = plural(amount, UNIT_NAMES[unit as RelativeUnit]);
    return sign === '-' ? `${amount} ${word} назад` : `через ${amount} ${word}`;
}
