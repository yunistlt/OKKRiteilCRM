import { EXTERNAL_DB_TITLES, externalDbConfigured, queryExternal } from '@/lib/shtab/external/client';
import { generateEmbedding } from '@/lib/embeddings';
import { isOpenAIConfigured } from '@/utils/openai';
import { supabase } from '@/utils/supabase';

// Инструменты Тамары поверх боевой базы ЦехУспеха (MySQL, схема zmk).
//
// Тот же уговор, что и в tamara-tools.ts: модель не пишет SQL. Запросы лежат
// здесь константами, модель вызывает именованную функцию с параметрами.
//
// Денежные запросы перенесены 1:1 из Delphi-форм ЦехУспеха (docs/shtab/schemas/tseh.md)
// и помечены исходной формой — чтобы цифру можно было сверить глазами с тем, что
// завод видит у себя. Наивный SUM по таблицам даёт число, которое с программой
// цеха не сходится: себестоимость, зарплата и материалы считаются хранимыми
// функциями (SalaryOrder, CostOrderExt, CostMaterialsItemOrderNDS).
//
// Мягкая деградация по образцу utils/openai.ts: нет SHTAB_DB_TSEH_URL или база
// недоступна — инструмент возвращает внятное «данных цеха сейчас нет», а не
// роняет чат.

type ToolResult = Record<string, unknown>;

/** Расшифровка ListBalanses.TypeData — 1:1 с Analytics.pas. */
export const BALANCE_TYPES: Record<number, string> = {
    1: 'Итоговый баланс',
    2: 'Итого остатки на счетах',
    3: 'Долг по заказам в производстве',
    4: 'Долг по счетам (по отгруженным заказам)',
    5: 'Долг по постоянным платежам',
    6: 'Долг по зарплате',
    7: 'Долг покупателей по неотгруженным заказам',
    8: 'Взаиморасчёты с поставщиками',
    9: 'Налог по зарплате',
    10: 'Налог на прибыль',
    11: 'НДС к уплате',
    12: 'Кредиторская задолженность по полученным авансам',
    13: 'Дебиторская задолженность по клиентам',
    14: 'Кредиторская задолженность перед поставщиками',
    15: 'Дебиторская задолженность по выданным авансам',
    16: 'Незавершённое производство',
    17: 'Баланс по депозитам',
    18: 'Долг покупателей по отгруженным заказам',
};

// ── SQL ────────────────────────────────────────────────────────────────────────
// Экспортируются, чтобы тест мог прогнать каждый через assertReadOnlyQuery:
// запрет на запись обязан проверяться на том самом тексте, который уходит в базу.

/**
 * Снимки финпоказателей за период. Форма «Итоговый баланс».
 *
 * Слово «ежедневные» к этой таблице не подходит, и это проверено на боевой:
 * за последние 60 дней все 18 показателей записаны лишь в 8 дней, а в остальные
 * дни пишется один показатель — депозиты. Снимок кладётся тогда, когда человек
 * открывает форму в ЦехУспехе, то есть примерно раз в неделю. Поэтому «взять
 * последний день месяца» дало бы пусто или один случайный показатель, и по
 * каждому дню возвращается ещё и число показателей в нём.
 */
export const SQL_BALANCE_HISTORY = `
SELECT DATE(b.DateUpdate) AS d, b.TypeData AS type_data, b.ValueData AS value_data
FROM ListBalanses b
JOIN (SELECT DATE(DateUpdate) dd, TypeData, MAX(DateUpdate) mx
      FROM ListBalanses
      WHERE DateUpdate >= ? AND DateUpdate < ?
      GROUP BY dd, TypeData) t
  ON t.mx = b.DateUpdate AND t.TypeData = b.TypeData
ORDER BY d, b.TypeData`;

/** Выручка по месяцам, без НДС. Источник: ListSales.pas, строки 247–261. */
function revenueSql(dateField: 'DateDelivery' | 'DateReadyDelivery'): string {
    return `
SELECT DATE_FORMAT(O.${dateField}, '%Y-%m') AS m,
       COUNT(DISTINCT O.ID) AS orders_cnt,
       ROUND(SUM(IO.TotalPriceFact - ROUND(IF(CPS.PercentNDS > 0 AND IO.PercentNDS > 0,
             (IO.TotalPriceFact * IO.PercentNDS) / (100 + IO.PercentNDS), 0), 2)), 2) AS revenue_no_vat
FROM Orders O
JOIN ItemsOrders IO ON IO.IDOrder = O.ID
LEFT JOIN CounterParties CPS ON O.IDSeller = CPS.ID
WHERE O.Basket = 0 AND O.${dateField} >= ? AND O.${dateField} < ?
GROUP BY m ORDER BY m`;
}

export const SQL_REVENUE_BY_DELIVERY = revenueSql('DateDelivery');
export const SQL_REVENUE_BY_READY = revenueSql('DateReadyDelivery');

/**
 * Прибыль и маржа по месяцам. Источник: ListSales.pas, строки 325–340.
 *
 * Отличие от оригинала одно, и оно вынужденное. В форме ЦехУспеха материалы
 * считает функция CostMaterialsItemOrderNDS, а она внутри создаёт временные
 * таблицы — под read-only транзакцией это ошибка 1792, и правильно: временные
 * таблицы Тамаре не выдаются. Но первой же строкой эта функция возвращает кэш
 * ItemsOrders.RCalcMONDS, если он посчитан (gb_zmk_схема.sql, тело функции).
 * Поэтому берётся тот же кэш напрямую — это ровно то число, что вернула бы
 * функция, а не самодельная замена ей.
 *
 * Где кэша нет, пересчитать его нечем. Такие заказы из прибыли исключаются, а
 * их доля возвращается отдельным полем: месяц, посчитанный по половине заказов,
 * обязан выглядеть как посчитанный по половине заказов.
 *
 * SalaryOrder и CostOrderExt под read-only работают — проверено на боевой.
 */
export const SQL_PROFIT_HISTORY = `
SELECT DATE_FORMAT(t.DateDelivery, '%Y-%m') AS m,
       COUNT(*) AS orders_total,
       SUM(IF(t.mat_missing = 0, 1, 0)) AS orders_costed,
       ROUND(SUM(t.PriceFactNDS), 2) AS revenue_no_vat,
       ROUND(SUM(IF(t.mat_missing = 0, t.PriceFactNDS, 0)), 2) AS revenue_costed,
       ROUND(SUM(IF(t.mat_missing = 0, t.MatNDS, 0)), 2) AS materials,
       ROUND(SUM(IF(t.mat_missing = 0, t.Salary, 0)), 2) AS salary,
       ROUND(SUM(IF(t.mat_missing = 0, t.Salary * 0.28, 0)), 2) AS salary_taxes,
       ROUND(SUM(IF(t.mat_missing = 0, t.Cost, 0)), 2) AS other_costs,
       ROUND(SUM(IF(t.mat_missing = 0,
             t.PriceFactNDS - t.Salary - (t.Salary * 0.28) - t.Cost - t.MatNDS, 0)), 2) AS profit,
       ROUND(SUM(IF(t.mat_missing = 0,
             t.PriceFactNDS - t.Salary - (t.Salary * 0.28) - t.Cost - t.MatNDS, 0)) * 100
             / NULLIF(SUM(IF(t.mat_missing = 0, t.PriceFactNDS, 0)), 0), 2) AS margin_pct
FROM (
  SELECT O.ID, O.DateDelivery,
         SalaryOrder(O.ID) AS Salary,
         CostOrderExt(O.ID) AS Cost,
         IFNULL((SELECT SUM(IF(IO.PercentNDS = 0, IO.TotalPriceFact,
                    IO.TotalPriceFact * 100 / (100 + IO.PercentNDS)))
                 FROM ItemsOrders IO WHERE IO.IDOrder = O.ID), 0) AS PriceFactNDS,
         IFNULL((SELECT SUM(IO.RCalcMONDS) FROM ItemsOrders IO WHERE IO.IDOrder = O.ID), 0) AS MatNDS,
         (SELECT COUNT(*) FROM ItemsOrders IO WHERE IO.IDOrder = O.ID AND IO.RCalcMONDS IS NULL) AS mat_missing
  FROM Orders O
  WHERE O.Basket = 0 AND O.DateDelivery >= ? AND O.DateDelivery < ?
) t
GROUP BY m ORDER BY m`;

/**
 * Дебиторка «на сейчас». Источник: ListSales.pas, строки 297–304.
 * IDPayment IS NOT NULL обязательно (BUG-18): у ЗМК включена привязка оплат к
 * заказам, без этого условия долг занижается в разы.
 */
export const SQL_DEBT = `
SELECT SUM(IF(PriceFact >= Payed, PriceFact - Payed, 0)) AS debt
FROM (
  SELECT ROUND(IFNULL((SELECT SUM(IPO.Amount) FROM ItemsPaymentsOrders IPO
                       WHERE IPO.IDOrder = O.ID AND IPO.IDPayment IS NOT NULL), 0), 2) AS Payed,
         ROUND(IFNULL((SELECT SUM(IO.TotalPriceFact) FROM ItemsOrders IO
                       WHERE IO.IDOrder = O.ID), 0), 2) AS PriceFact
  FROM Orders O
  LEFT JOIN StatusesOrders SO ON O.IDStatus = SO.ID
  WHERE O.Basket = 0 AND O.IDSeller <> O.IDPurchaser AND O.DateOrder >= '2020-01-01'
    AND SO.NameStatus IN ('В производстве','Новый','Выполнен','Готов к отгрузке',
                          'Рекламация','Перепродажа мебели','Отгружен')
) t`;

/** Клиенты за период: сколько заказов, на какую сумму, первый и последний. */
export const SQL_CUSTOMERS = `
SELECT CP.ID AS id, CP.NameCounterParty AS name,
       COUNT(DISTINCT O.ID) AS orders_cnt,
       MIN(O.DateOrder) AS first_order,
       MAX(O.DateOrder) AS last_order,
       ROUND(SUM(IO.TotalPriceFact), 2) AS total_amount
FROM Orders O
JOIN ItemsOrders IO ON IO.IDOrder = O.ID
JOIN CounterParties CP ON O.IDPurchaser = CP.ID
WHERE O.Basket = 0 AND O.DateOrder >= ?
GROUP BY CP.ID, CP.NameCounterParty
ORDER BY total_amount DESC
LIMIT 100`;

/**
 * Диагностика, а не показатель: насколько заполнены поля времени у операций.
 *
 * От этого числа зависит весь цеховой контур (такт, узкое место, пролёживание).
 * В схеме ЦехУспеха поля есть — ItemsTexCards.TimeExecution, AvgTime, DateBegin,
 * DateEnd, — но соседняя сессия, снимавшая базу, утверждает, что у ЗМК нормы не
 * заполнены. Проверяется это одним запросом, а не спором; пока доля заполнения
 * не измерена на боевой, цеховых инструментов быть не должно: неверное число
 * хуже пропуска, пропуск владелец видит, а число принимает за правду.
 */
export const SQL_OPS_COVERAGE = `
SELECT COUNT(*) AS ops_total,
       SUM(IF(ITC.TimeExecution > 0, 1, 0)) AS with_norm_time,
       SUM(IF(ITC.AvgTime > 0, 1, 0)) AS with_avg_time,
       SUM(IF(ITC.DateBegin IS NOT NULL, 1, 0)) AS with_date_begin,
       SUM(IF(ITC.DateEnd IS NOT NULL, 1, 0)) AS with_date_end,
       SUM(IF(ITC.IDMade > 0, 1, 0)) AS with_worker,
       SUM(IF(ITC.Price > 0, 1, 0)) AS with_price,
       MIN(ITC.DateEnd) AS first_closed,
       MAX(ITC.DateEnd) AS last_closed
FROM ItemsTexCards ITC
JOIN TexCards TC ON TC.ID = ITC.IDTexCard
WHERE TC.Basket = 0 AND TC.DateCreate >= ?`;

// ── описания инструментов для модели ──────────────────────────────────────────

export const TSEH_TOOLS = [
    {
        type: 'function' as const,
        function: {
            name: 'tseh_balance_history',
            description:
                'Финансовые показатели завода ЗМК по дням из ЦехУспеха: итоговый баланс, остатки на счетах, дебиторка, кредиторка, незавершённое производство, долги по зарплате и налогам — 18 показателей. Это те же цифры, что завод видит на своём дашборде. Данные с 29.11.2020. ВАЖНО: снимки нерегулярные — полный набор показателей появляется примерно раз в неделю, смотри поля показателей_в_снимке и last_full_snapshot.',
            parameters: {
                type: 'object',
                properties: {
                    months: { type: 'integer', description: 'Сколько последних месяцев. По умолчанию 12.' },
                    types: {
                        type: 'array',
                        items: { type: 'integer' },
                        description: 'Коды показателей 1..18. По умолчанию все.',
                    },
                },
            },
        },
    },
    {
        type: 'function' as const,
        function: {
            name: 'tseh_revenue_history',
            description:
                'Выручка завода по месяцам, без НДС, и количество заказов. По умолчанию по отгрузке; by="ready" — по готовности к отгрузке (в ЦехУспехе это две разные цифры, не путать).',
            parameters: {
                type: 'object',
                properties: {
                    months: { type: 'integer', description: 'Сколько последних месяцев. По умолчанию 12.' },
                    by: { type: 'string', enum: ['delivery', 'ready'], description: 'По отгрузке или по готовности.' },
                },
            },
        },
    },
    {
        type: 'function' as const,
        function: {
            name: 'tseh_profit_history',
            description:
                'Прибыль и маржа завода по месяцам: выручка без НДС минус зарплата заказа, взносы 28%, себестоимость и материалы. Считается функциями самого ЦехУспеха. Запрос тяжёлый — не больше года за вызов.',
            parameters: {
                type: 'object',
                properties: {
                    months: { type: 'integer', description: 'Сколько последних месяцев, не больше 12. По умолчанию 12.' },
                },
            },
        },
    },
    {
        type: 'function' as const,
        function: {
            name: 'tseh_debt',
            description:
                'Дебиторская задолженность завода на сейчас: сколько должны по неоплаченным заказам. За историю по дням бери tseh_balance_history, коды 13 и 18.',
            parameters: { type: 'object', properties: {} },
        },
    },
    {
        type: 'function' as const,
        function: {
            name: 'tseh_customers',
            description:
                'Клиенты завода за период: число заказов, сумма, первый и последний заказ. Отвечает на «кто постоянный», «кто отвалился», «на скольких клиентах держится выручка». До 100 крупнейших.',
            parameters: {
                type: 'object',
                properties: {
                    months: { type: 'integer', description: 'Сколько последних месяцев. По умолчанию 24.' },
                },
            },
        },
    },
    {
        type: 'function' as const,
        function: {
            name: 'tseh_ops_coverage',
            description:
                'Служебная проверка: заполнены ли у операций техкарт нормы времени, даты начала и окончания, исполнитель. От этого зависит, можно ли вообще считать из ЦехУспеха такт, пропускную способность и пролёживание. Вызывай, когда владелец спрашивает про цеховые показатели времени — и отвечай по факту заполнения, а не по наличию полей.',
            parameters: {
                type: 'object',
                properties: {
                    months: { type: 'integer', description: 'За какой период смотреть техкарты. По умолчанию 12 месяцев.' },
                },
            },
        },
    },
    {
        type: 'function' as const,
        function: {
            name: 'tseh_logic',
            description:
                'Как устроен сам ЦехУспех: тела расчётных функций MySQL, структура таблиц и код форм. Вызывай, когда нужно объяснить, ОТКУДА берётся цифра или как программа считает — например «как считается себестоимость», «когда проставляется дата отгрузки», «что лежит в таблице заказов». Отвечай по найденному коду и называй источник.',
            parameters: {
                type: 'object',
                properties: {
                    query: { type: 'string', description: 'Вопрос своими словами, например «как считается зарплата по заказу».' },
                    kind: {
                        type: 'string',
                        enum: ['function', 'table', 'unit'],
                        description: 'Сузить поиск: function — расчётные функции, table — структура таблиц, unit — формы Delphi.',
                    },
                },
                required: ['query'],
            },
        },
    },
] as const;

export const TSEH_TOOL_NAMES: ReadonlySet<string> = new Set<string>(TSEH_TOOLS.map((t) => t.function.name));

// ── исполнение ────────────────────────────────────────────────────────────────

function clampMonths(value: unknown, fallback: number, max: number): number {
    const n = Number(value);
    if (!Number.isFinite(n)) return fallback;
    return Math.min(max, Math.max(1, Math.trunc(n)));
}

/** Границы периода: с первого числа месяца N месяцев назад по завтра. */
export function monthWindow(months: number, now = new Date()): [string, string] {
    const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - (months - 1), 1));
    const to = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
    return [from.toISOString().slice(0, 10), to.toISOString().slice(0, 10)];
}

const num = (v: unknown): number | null => {
    if (v === null || v === undefined) return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
};

async function readBalanceHistory(months: number, types: number[]): Promise<ToolResult> {
    const [from, to] = monthWindow(months);
    const rows = await queryExternal<any>('tseh', SQL_BALANCE_HISTORY, [from, to]);
    const wanted = new Set(types);

    const byDay = new Map<string, { values: Record<string, number | null>; captured: Set<number> }>();
    for (const r of rows) {
        const code = Number(r.type_data);
        const day = String(r.d).slice(0, 10);
        const bucket = byDay.get(day) ?? { values: {}, captured: new Set<number>() };
        // Полнота снимка считается по ВСЕМ показателям дня, а не по запрошенным:
        // иначе фильтр по одному коду делал бы любой день «неполным».
        bucket.captured.add(code);
        if (wanted.size === 0 || wanted.has(code)) {
            bucket.values[BALANCE_TYPES[code] ?? `Показатель ${code}`] = num(r.value_data);
        }
        byDay.set(day, bucket);
    }

    const days = Array.from(byDay.entries()).map(([date, b]) => ({
        date,
        показателей_в_снимке: b.captured.size,
        ...b.values,
    }));
    const full = days.filter((d) => d.показателей_в_снимке >= 18).map((d) => d.date);

    return {
        period: { from, to },
        unit: 'рубли',
        days,
        last_full_snapshot: full.length > 0 ? full[full.length - 1] : null,
        note:
            'Снимок кладётся, когда в ЦехУспехе открывают форму «Итоговый баланс» — примерно раз в неделю, не каждый день. ' +
            'Дни, где показателей_в_снимке меньше 18, неполные: отсутствие показателя в такой день означает «не снимали», а не ноль. ' +
            'Для сравнения периодов бери дни из last_full_snapshot и подобные им полные.',
    };
}

async function readRevenueHistory(months: number, by: 'delivery' | 'ready'): Promise<ToolResult> {
    const [from, to] = monthWindow(months);
    const sql = by === 'ready' ? SQL_REVENUE_BY_READY : SQL_REVENUE_BY_DELIVERY;
    const rows = await queryExternal<any>('tseh', sql, [from, to]);
    return {
        period: { from, to },
        basis: by === 'ready' ? 'по готовности к отгрузке' : 'по отгрузке',
        unit: 'рубли без НДС',
        months: rows.map((r) => ({
            month: r.m,
            orders: num(r.orders_cnt),
            revenue_no_vat: num(r.revenue_no_vat),
        })),
    };
}

async function readProfitHistory(months: number): Promise<ToolResult> {
    const [from, to] = monthWindow(months);
    const rows = await queryExternal<any>('tseh', SQL_PROFIT_HISTORY, [from, to]);
    return {
        period: { from, to },
        unit: 'рубли',
        formula: 'выручка без НДС − зарплата заказа − 28% взносов − материалы − прочие расходы',
        // Слагаемые печатаются рядом с итогом: маржа без структуры — цифра, с
        // которой нечего делать, а тут сразу видно, чем месяц отличается.
        components: {
            materials: 'расход материалов на заказ: количество из потребности × цена из счёта поставщика по этому заказу, иначе историческая цена закупки за 3 года',
            salary: 'сдельная зарплата по заказу (SalaryOrder)',
            other_costs: 'счета поставщиков с типом «прочие расходы» (CostOrderExt); у ЗМК почти нулевые — это данные, а не пропуск',
        },
        // Прибыль считается не по всем заказам, а по тем, у кого посчитаны
        // материалы. Разница между orders и orders_costed — это не погрешность,
        // а прямо названный кусок месяца, о котором сказать нечего.
        note: 'profit и margin_pct посчитаны только по заказам, где ЦехУспех посчитал материалы (orders_costed из orders). revenue_no_vat — по всем.',
        months: rows.map((r) => ({
            month: r.m,
            orders: num(r.orders_total),
            orders_costed: num(r.orders_costed),
            revenue_no_vat: num(r.revenue_no_vat),
            revenue_costed: num(r.revenue_costed),
            materials: num(r.materials),
            salary: num(r.salary),
            salary_taxes: num(r.salary_taxes),
            other_costs: num(r.other_costs),
            profit: num(r.profit),
            margin_pct: num(r.margin_pct),
        })),
    };
}

async function readDebt(): Promise<ToolResult> {
    const rows = await queryExternal<any>('tseh', SQL_DEBT, []);
    return {
        as_of: new Date().toISOString().slice(0, 10),
        unit: 'рубли',
        debt: num(rows[0]?.debt) ?? 0,
        note: 'Долг по неоплаченным заказам на сейчас. Историю по дням смотри в tseh_balance_history, коды 13 и 18.',
    };
}

async function readCustomers(months: number): Promise<ToolResult> {
    const [from] = monthWindow(months);
    const rows = await queryExternal<any>('tseh', SQL_CUSTOMERS, [from]);
    return {
        since: from,
        unit: 'рубли',
        customers: rows.map((r) => ({
            name: r.name,
            orders: num(r.orders_cnt),
            total_amount: num(r.total_amount),
            first_order: r.first_order ? String(r.first_order).slice(0, 10) : null,
            last_order: r.last_order ? String(r.last_order).slice(0, 10) : null,
        })),
    };
}

async function readOpsCoverage(months: number): Promise<ToolResult> {
    const [from] = monthWindow(months);
    const rows = await queryExternal<any>('tseh', SQL_OPS_COVERAGE, [from]);
    const r = rows[0] ?? {};
    const total = num(r.ops_total) ?? 0;
    const pct = (v: unknown) => (total > 0 ? Math.round(((num(v) ?? 0) * 1000) / total) / 10 : null);

    const normPct = pct(r.with_norm_time);
    const endPct = pct(r.with_date_end);

    return {
        since: from,
        operations_total: total,
        filled_pct: {
            'норма времени (TimeExecution)': normPct,
            'среднее время (AvgTime)': pct(r.with_avg_time),
            'дата начала': pct(r.with_date_begin),
            'дата окончания': pct(r.with_date_end),
            исполнитель: pct(r.with_worker),
            расценка: pct(r.with_price),
        },
        first_closed: r.first_closed ? String(r.first_closed).slice(0, 10) : null,
        last_closed: r.last_closed ? String(r.last_closed).slice(0, 10) : null,
        // Вывод делается здесь, а не моделью: порог решает, можно ли строить на
        // этих данных такт и узкое место, и он должен быть один и тот же всегда.
        verdict:
            total === 0
                ? 'Операций за период нет — судить не о чем'
                : (normPct ?? 0) >= 80
                  ? 'Нормы времени заполнены: цеховые показатели времени считать можно'
                  : (endPct ?? 0) >= 80
                    ? 'Норм времени нет, но операции закрываются датами: такт и пролёживание можно считать по фактическим датам, нормативную загрузку — нет'
                    : 'Ни норм, ни дат закрытия: цеховые показатели времени из ЦехУспеха не достаются, нужен ручной замер или доработка ЦехУспеха',
    };
}

/**
 * Поиск по логике ЦехУспеха.
 *
 * Живёт до проверки подключения к MySQL: код лежит в нашей базе, и объяснить,
 * как считается прибыль, Тамара может даже когда база цеха недоступна.
 */
/**
 * Поиск по логике ЦехУспеха.
 *
 * Живёт до проверки подключения к MySQL: код лежит в нашей базе, и объяснить,
 * как считается прибыль, Тамара может даже когда база цеха недоступна.
 *
 * Поиск двойной. Векторный отвечает на вопрос своими словами, но имена в
 * ЦехУспехе английские, а спрашивают по-русски: «как считается зарплата» не
 * вытаскивает SalaryOrder, потому что в теле функции нет ни одного русского
 * слова. Поэтому рядом идёт поиск по имени — по латинским словам из вопроса и
 * по переводу десятка ключевых понятий. Совпадение по имени ставится первым:
 * функция, названная ровно так, почти всегда и есть ответ.
 */
const NAME_HINTS: Record<string, string[]> = {
    зарплат: ['salary'],
    оклад: ['salary'],
    себестоимост: ['cost'],
    материал: ['material'],
    заказ: ['order'],
    отгруз: ['delivery'],
    оплат: ['payment', 'payed'],
    счет: ['bill'],
    счёт: ['bill'],
    склад: ['warehouse', 'wh'],
    техкарт: ['texcard'],
    операц: ['operat'],
    сотрудник: ['user'],
    контрагент: ['counterparty'],
    цен: ['price'],
    баланс: ['balans', 'balance'],
    налог: ['nds', 'tax'],
    прибыл: ['profit'],
};

function nameNeedles(query: string): string[] {
    const lower = query.toLowerCase();
    const needles = new Set<string>();
    for (const word of lower.match(/[a-z][a-z0-9_]{3,}/g) ?? []) needles.add(word);
    for (const [ru, en] of Object.entries(NAME_HINTS)) {
        if (lower.includes(ru)) en.forEach((n) => needles.add(n));
    }
    return Array.from(needles).slice(0, 6);
}

type LogicHit = { title: string; kind: string; name: string; source: string; code: string; matched_by: string };

function toHit(row: any, matchedBy: string): LogicHit {
    return {
        title: row.title,
        kind: row.kind,
        name: row.name,
        source: row.source_ref,
        // Код обрезается: шесть целых форм Delphi не влезут в ответ, а начала
        // хватает, чтобы понять логику и назвать источник.
        code: String(row.content).slice(0, 4000),
        matched_by: matchedBy,
    };
}

async function readLogic(query: string, kind?: string): Promise<ToolResult> {
    if (!query.trim()) return { available: false, reason: 'Пустой вопрос' };
    if (!isOpenAIConfigured()) return { available: false, reason: 'Поиск по коду недоступен: нет OPENAI_API_KEY' };

    const hits: LogicHit[] = [];
    const seen = new Set<string>();

    const needles = nameNeedles(query);
    if (needles.length > 0) {
        // Имена функций и таблиц, а не куски форм: искать по имени модуля Delphi
        // бессмысленно, там оно про экран, а не про расчёт.
        const { data } = await supabase
            .from('shtab_tseh_code')
            .select('slug, kind, name, title, content, source_ref')
            .eq('is_active', true)
            .in('kind', kind === 'unit' ? ['function'] : kind ? [kind] : ['function', 'table'])
            .or(needles.map((n) => `name.ilike.%${n}%`).join(','))
            .limit(40);

        // Слово «order» сидит в сотне имён, поэтому совпадений по имени берётся
        // всего три и по правилу «чем меньше лишнего в имени, тем ближе к делу»:
        // на вопрос про зарплату так первым идёт SalaryOrder, а не
        // CalcBonusAheadOfScheduleOrderSalary. Смысловой поиск идёт следом и
        // вытягивает то, что по имени не угадать.
        const ranked = ((data ?? []) as any[])
            .map((row) => {
                const name = String(row.name).toLowerCase();
                const hit = needles.filter((n) => name.includes(n));
                const exact = needles.some((n) => name === n) ? 0 : 1;
                return { row, score: [exact, -hit.length, name.length] as const };
            })
            .sort((a, b) => a.score[0] - b.score[0] || a.score[1] - b.score[1] || a.score[2] - b.score[2])
            .slice(0, 3);

        for (const { row } of ranked) {
            seen.add(row.slug);
            hits.push(toHit(row, 'имя'));
        }
    }

    const embedding = await generateEmbedding(query);
    const { data, error } = await supabase.rpc('match_shtab_tseh_code', {
        query_embedding: embedding,
        match_threshold: 0.2,
        match_count: 6,
        filter_kind: kind ?? null,
    });
    if (error) throw new Error(error.message);

    for (const row of (data ?? []) as any[]) {
        if (seen.has(row.slug)) continue;
        seen.add(row.slug);
        hits.push(toHit(row, 'смысл'));
    }

    if (hits.length === 0) {
        return {
            found: [],
            note: 'В коде ЦехУспеха по этому вопросу ничего не нашлось. Не выдумывай логику — скажи, что не нашла.',
        };
    }

    return {
        found: hits.slice(0, 8),
        note: 'Это код чужой программы. Отвечай по нему и называй источник, а не пересказывай по памяти.',
    };
}

export async function executeTsehTool(name: string, args: any): Promise<ToolResult> {
    if (name === 'tseh_logic') {
        try {
            const kind = ['function', 'table', 'unit'].includes(args?.kind) ? args.kind : undefined;
            return await readLogic(String(args?.query ?? ''), kind);
        } catch (e: any) {
            return { available: false, reason: `Поиск по коду ЦехУспеха не удался: ${e.message}` };
        }
    }

    if (!externalDbConfigured('tseh')) {
        return {
            available: false,
            reason: `Данных цеха сейчас нет: база «${EXTERNAL_DB_TITLES.tseh}» не подключена (нет SHTAB_DB_TSEH_URL)`,
        };
    }

    try {
        if (name === 'tseh_balance_history') {
            const types = Array.isArray(args?.types)
                ? args.types.map((t: unknown) => Number(t)).filter((t: number) => t >= 1 && t <= 18)
                : [];
            return await readBalanceHistory(clampMonths(args?.months, 12, 60), types);
        }
        if (name === 'tseh_revenue_history') {
            const by = args?.by === 'ready' ? 'ready' : 'delivery';
            return await readRevenueHistory(clampMonths(args?.months, 12, 60), by);
        }
        if (name === 'tseh_profit_history') {
            // Потолок в 12 месяцев не каприз: запрос вызывает хранимые функции на
            // каждый заказ, на всей истории он положит боевую базу цеха.
            return await readProfitHistory(clampMonths(args?.months, 12, 12));
        }
        if (name === 'tseh_debt') return await readDebt();
        if (name === 'tseh_customers') return await readCustomers(clampMonths(args?.months, 24, 120));
        if (name === 'tseh_ops_coverage') return await readOpsCoverage(clampMonths(args?.months, 12, 60));
        return { available: false, reason: `Неизвестный инструмент: ${name}` };
    } catch (e: any) {
        return { available: false, reason: `Данных цеха сейчас нет: ${e.message}` };
    }
}
