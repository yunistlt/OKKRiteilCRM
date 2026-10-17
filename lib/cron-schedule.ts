/**
 * Разбор крон-выражений из vercel.json.
 *
 * Зачем. Сторож конвейера раньше судил о живости очереди по одному нормативу на
 * всех: «очередь обязана доделывать что-то каждые 45 минут». 16.10.2026 часть
 * воркеров перевели на рабочее время (`0 5,8,11,14 * * 1-5`), и в первую же
 * субботу сторож поднял тревогу тем, что никто не работает в выходной.
 *
 * Отсюда правило: тревога — только когда исполнитель по расписанию ДОЛЖЕН был
 * прийти и не пришёл. Чтобы это посчитать, надо уметь читать само расписание.
 *
 * Время везде UTC: кроны Vercel считаются по Гринвичу, а не по Москве.
 */

/** Разобранное выражение: раскрытые допустимые значения по каждому полю. */
export type CronSpec = {
    expression: string;
    minutes: Set<number>;
    hours: Set<number>;
    daysOfMonth: Set<number>;
    months: Set<number>;
    daysOfWeek: Set<number>;
    /** Стандарт cron: если указаны и день месяца, и день недели, подходит любой из них. */
    dayUnionMode: boolean;
};

type FieldRange = { min: number; max: number };

const FIELDS: FieldRange[] = [
    { min: 0, max: 59 }, // минуты
    { min: 0, max: 23 }, // часы
    { min: 1, max: 31 }, // день месяца
    { min: 1, max: 12 }, // месяц
    { min: 0, max: 6 }, // день недели, 0 — воскресенье
];

/** Раскрывает одно поле: `*`, `*​/5`, `3`, `5-14`, `5-14/2`, `5,8,11,14`. */
function parseField(raw: string, range: FieldRange): Set<number> {
    const values = new Set<number>();

    for (const part of raw.split(',')) {
        const piece = part.trim();
        if (!piece) throw new Error(`пустая часть поля «${raw}»`);

        const [body, stepRaw] = piece.split('/');
        const step = stepRaw === undefined ? 1 : Number(stepRaw);
        if (!Number.isInteger(step) || step <= 0) throw new Error(`шаг «${stepRaw}» не число`);

        let from: number;
        let to: number;

        if (body === '*') {
            from = range.min;
            to = range.max;
        } else if (body.includes('-')) {
            const [fromRaw, toRaw] = body.split('-');
            from = Number(fromRaw);
            to = Number(toRaw);
        } else {
            from = Number(body);
            to = Number(body);
        }

        if (!Number.isInteger(from) || !Number.isInteger(to)) throw new Error(`«${body}» не число`);
        if (from < range.min || to > range.max || from > to) throw new Error(`«${body}» вне допустимых значений`);

        for (let value = from; value <= to; value += step) values.add(value);
    }

    return values;
}

/**
 * Разбирает выражение из пяти полей. Бросает исключение на всём, чего не понимает:
 * молча принять незнакомое расписание опаснее, чем признаться, что не разобрали —
 * неверно понятое расписание даёт ложную тревогу или, хуже, молчание при аварии.
 */
export function parseCron(expression: string): CronSpec {
    const parts = expression.trim().split(/\s+/);
    if (parts.length !== 5) throw new Error(`ожидалось 5 полей, получено ${parts.length}: «${expression}»`);

    const [minutes, hours, daysOfMonth, months, daysOfWeek] = parts.map((part, index) =>
        parseField(part, FIELDS[index]),
    );

    return {
        expression: expression.trim(),
        minutes,
        hours,
        daysOfMonth,
        months,
        daysOfWeek,
        dayUnionMode: parts[2] !== '*' && parts[4] !== '*',
    };
}

/** Разбирает выражение, но вместо исключения отдаёт null — для необязательных мест. */
export function tryParseCron(expression: string): CronSpec | null {
    try {
        return parseCron(expression);
    } catch {
        return null;
    }
}

/** Приходится ли запуск ровно на эту минуту (UTC). */
export function cronMatchesAt(spec: CronSpec, at: Date): boolean {
    if (!spec.minutes.has(at.getUTCMinutes())) return false;
    if (!spec.hours.has(at.getUTCHours())) return false;
    if (!spec.months.has(at.getUTCMonth() + 1)) return false;

    const dayOfMonthFits = spec.daysOfMonth.has(at.getUTCDate());
    const dayOfWeekFits = spec.daysOfWeek.has(at.getUTCDay());

    return spec.dayUnionMode ? dayOfMonthFits || dayOfWeekFits : dayOfMonthFits && dayOfWeekFits;
}

const MINUTE_MS = 60_000;
/** Дальше двух недель назад не смотрим: порогов больше этого у нас нет, а перебор не бесплатный. */
const MAX_LOOKBACK_MINUTES = 14 * 24 * 60;

function floorToMinute(date: Date): number {
    return Math.floor(date.getTime() / MINUTE_MS) * MINUTE_MS;
}

/**
 * Сколько раз расписание срабатывало в промежутке (from; to].
 *
 * Считаем перебором по минутам — за две недели это 20 тысяч проверок, доли
 * миллисекунды, зато без единой зависимости и без собственной арифметики календаря,
 * в которой легко ошибиться на месяцах и високосных годах.
 */
export function cronRunsBetween(spec: CronSpec, from: Date, to: Date): number {
    const end = floorToMinute(to);
    const earliest = end - MAX_LOOKBACK_MINUTES * MINUTE_MS;
    const start = Math.max(floorToMinute(from), earliest);

    let runs = 0;
    for (let stamp = start + MINUTE_MS; stamp <= end; stamp += MINUTE_MS) {
        if (cronMatchesAt(spec, new Date(stamp))) runs += 1;
    }

    return runs;
}

/** Последний запуск по расписанию не позже указанного момента. null — за две недели не было. */
export function lastCronRunAt(spec: CronSpec, now: Date): Date | null {
    const end = floorToMinute(now);

    for (let offset = 0; offset <= MAX_LOOKBACK_MINUTES; offset += 1) {
        const stamp = new Date(end - offset * MINUTE_MS);
        if (cronMatchesAt(spec, stamp)) return stamp;
    }

    return null;
}
