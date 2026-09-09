// Приход группы по месяцам — единственная статистика Штаба, которая уже стоит
// на живых данных.
//
// Источник — `point_payments`: выписки Точки и Т-Банка по всем юрлицам группы.
// Складывается ровно то, что пришло на счета, и ничего сверх этого.
//
// ВАЖНО про название метрики. В макете строка называлась «денежный поток».
// Денежного потока в данных нет: `lib/payments/tbank.ts` пишет в базу только
// входящие операции (`if (operationDirection(op) !== 'in') return null`) —
// расходов в таблице физически не существует. Считать поток из одних приходов
// значит выдавать выручку за прибыль, поэтому метрика называется «Приход группы».

/**
 * Статусы, которые НЕ являются приходом от клиентов.
 *
 * `ignored` ставится в `lib/payments/service.ts`, когда платёж опознан как
 * перевод между своими юрлицами, банковская операция (депозит, проценты,
 * возврат банка) или отброшен оператором вручную. Включать их — раздувать
 * приход собственными деньгами, гоняемыми по кругу.
 *
 * Остальные статусы (`pending_match`, `matched`, `manual`, `failed`) говорят
 * только о том, удалось ли привязать платёж к заказу. Деньги на счёт при этом
 * пришли, и в приход они входят.
 */
export const NON_INCOME_STATUSES = ['ignored'] as const;

export type IncomeRow = { payment_date: string | null; amount_kopecks: number | string | null };

export type MonthlyPoint = { month: string; rubles: number };

/**
 * Суммирует платежи по месяцам и переводит копейки в рубли.
 *
 * Пустые месяцы не выдумываются: XmR должен видеть реальные наблюдения, а не
 * нули, которых не было. Месяцы возвращаются по возрастанию.
 */
export function monthlyIncome(rows: readonly IncomeRow[]): MonthlyPoint[] {
    // Копейки складываются целыми числами: сложение целых точно до 2^53, а это
    // 90 триллионов рублей — потолок недостижимый. Делим на сто один раз в конце,
    // потому что сложение рублей с плавающей точкой накапливает ошибку.
    const byMonth: Record<string, number> = {};

    for (const row of rows) {
        if (!row.payment_date) continue;
        const month = String(row.payment_date).slice(0, 7); // YYYY-MM
        if (month.length !== 7) continue;

        const raw = row.amount_kopecks;
        if (raw === null || raw === undefined) continue;
        const kopecks = typeof raw === 'string' ? Number(raw.trim()) : raw;
        if (!Number.isFinite(kopecks)) continue;

        byMonth[month] = (byMonth[month] ?? 0) + Math.round(kopecks);
    }

    return Object.keys(byMonth)
        .sort()
        .map((month) => ({ month, rubles: byMonth[month] / 100 }));
}

/** Первое число месяца, отстоящего на `months` назад. Границей берётся начало месяца. */
export function monthsAgo(months: number, now: Date): string {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - months, 1));
    return d.toISOString().slice(0, 10);
}
