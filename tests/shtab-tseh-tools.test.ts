import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { assertReadOnlyQuery } from '@/lib/shtab/external/client';

// Инструменты Тамары по боевой базе цеха. Проверяется то, что проверяемо без
// самой базы: каждый SQL действительно только читает, разбор ответа не врёт
// числом, а отсутствие подключения даёт внятный отказ, а не падение чата.

const queryExternal = vi.hoisted(() => vi.fn());

vi.mock('@/lib/shtab/external/client', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@/lib/shtab/external/client')>();
    return { ...actual, queryExternal };
});

const ENV = process.env.SHTAB_DB_TSEH_URL;

beforeEach(() => {
    queryExternal.mockReset();
    process.env.SHTAB_DB_TSEH_URL = 'mysql://tamara_ro:x@localhost:3306/zmk';
});

afterEach(() => {
    if (ENV === undefined) delete process.env.SHTAB_DB_TSEH_URL;
    else process.env.SHTAB_DB_TSEH_URL = ENV;
});

describe('SQL инструментов цеха', () => {
    it('каждый запрос проходит рубеж «только чтение»', async () => {
        const mod = await import('@/lib/shtab/tseh-tools');
        const queries = Object.entries(mod)
            .filter(([name]) => name.startsWith('SQL_'))
            .map(([name, sql]) => [name, sql as string] as const);

        expect(queries.length).toBeGreaterThanOrEqual(6);
        for (const [name, sql] of queries) {
            expect(() => assertReadOnlyQuery(sql, 'mysql'), name).not.toThrow();
        }
    });

    it('выручка по готовности и по отгрузке — разные запросы', async () => {
        const { SQL_REVENUE_BY_DELIVERY, SQL_REVENUE_BY_READY } = await import('@/lib/shtab/tseh-tools');
        expect(SQL_REVENUE_BY_DELIVERY).not.toBe(SQL_REVENUE_BY_READY);
        expect(SQL_REVENUE_BY_READY).toContain('DateReadyDelivery');
    });

    it('дебиторка считает оплатой только строку с платёжным документом (BUG-18)', async () => {
        const { SQL_DEBT } = await import('@/lib/shtab/tseh-tools');
        expect(SQL_DEBT).toContain('IPO.IDPayment IS NOT NULL');
    });
});

describe('без подключения к базе цеха', () => {
    it('инструмент отказывает внятно, а не падает', async () => {
        delete process.env.SHTAB_DB_TSEH_URL;
        const { executeTsehTool } = await import('@/lib/shtab/tseh-tools');
        const res = await executeTsehTool('tseh_debt', {});
        expect(res.available).toBe(false);
        expect(String(res.reason)).toContain('ЦехУспех');
        expect(queryExternal).not.toHaveBeenCalled();
    });

    it('ошибка базы не бросается наружу', async () => {
        queryExternal.mockRejectedValue(new Error('connect ETIMEDOUT'));
        const { executeTsehTool } = await import('@/lib/shtab/tseh-tools');
        const res = await executeTsehTool('tseh_debt', {});
        expect(res.available).toBe(false);
        expect(String(res.reason)).toContain('ETIMEDOUT');
    });
});

describe('разбор ответа', () => {
    it('баланс раскладывается по дням с русскими названиями показателей', async () => {
        queryExternal.mockResolvedValue([
            { d: '2026-08-01', type_data: 1, value_data: '1000.5' },
            { d: '2026-08-01', type_data: 16, value_data: '200' },
        ]);
        const { executeTsehTool } = await import('@/lib/shtab/tseh-tools');
        const res: any = await executeTsehTool('tseh_balance_history', { months: 1 });
        expect(res.days[0]).toMatchObject({
            date: '2026-08-01',
            показателей_в_снимке: 2,
            'Итоговый баланс': 1000.5,
            'Незавершённое производство': 200,
        });
    });

    it('фильтр по кодам показателей отсекает лишнее', async () => {
        queryExternal.mockResolvedValue([
            { d: '2026-08-01', type_data: 1, value_data: '1' },
            { d: '2026-08-01', type_data: 16, value_data: '2' },
        ]);
        const { executeTsehTool } = await import('@/lib/shtab/tseh-tools');
        const res: any = await executeTsehTool('tseh_balance_history', { months: 1, types: [16] });
        expect(Object.keys(res.days[0])).toEqual(['date', 'показателей_в_снимке', 'Незавершённое производство']);
        // Полнота снимка считается по всем показателям дня, а не по запрошенным.
        expect(res.days[0].показателей_в_снимке).toBe(2);
    });

    it('деньги приходят строками и становятся числами', async () => {
        queryExternal.mockResolvedValue([{ debt: '12345.67' }]);
        const { executeTsehTool } = await import('@/lib/shtab/tseh-tools');
        const res: any = await executeTsehTool('tseh_debt', {});
        expect(res.debt).toBe(12345.67);
    });

    it('период прибыли не растягивается дальше года', async () => {
        queryExternal.mockResolvedValue([]);
        const { executeTsehTool, monthWindow } = await import('@/lib/shtab/tseh-tools');
        await executeTsehTool('tseh_profit_history', { months: 60 });
        const [from, to] = queryExternal.mock.calls[0][2];
        expect([from, to]).toEqual(monthWindow(12));
    });
});

describe('нерегулярность снимков баланса', () => {
    it('неполный день помечен, last_full_snapshot пуст', async () => {
        queryExternal.mockResolvedValue([{ d: '2026-08-20', type_data: 17, value_data: '1' }]);
        const { executeTsehTool } = await import('@/lib/shtab/tseh-tools');
        const res: any = await executeTsehTool('tseh_balance_history', { months: 1 });
        expect(res.days[0].показателей_в_снимке).toBe(1);
        expect(res.last_full_snapshot).toBeNull();
        expect(String(res.note)).toContain('не каждый день');
    });

    it('день со всеми 18 показателями попадает в last_full_snapshot', async () => {
        queryExternal.mockResolvedValue(
            Array.from({ length: 18 }, (_, i) => ({ d: '2026-08-25', type_data: i + 1, value_data: '1' })),
        );
        const { executeTsehTool } = await import('@/lib/shtab/tseh-tools');
        const res: any = await executeTsehTool('tseh_balance_history', { months: 1 });
        expect(res.last_full_snapshot).toBe('2026-08-25');
    });
});

describe('прибыль', () => {
    it('материалы берутся из кэша ЦехУспеха, а не пересчитываются функцией', async () => {
        const { SQL_PROFIT_HISTORY } = await import('@/lib/shtab/tseh-tools');
        // Функция CostMaterialsItemOrderNDS создаёт временные таблицы и под
        // read-only транзакцией падает с 1792 — проверено на боевой.
        expect(SQL_PROFIT_HISTORY).not.toContain('CostMaterialsItemOrderNDS');
        expect(SQL_PROFIT_HISTORY).toContain('RCalcMONDS');
        expect(SQL_PROFIT_HISTORY).toContain('SalaryOrder(O.ID)');
    });

    it('месяц показывает, по скольким заказам посчитана прибыль', async () => {
        queryExternal.mockResolvedValue([
            {
                m: '2026-07', orders_total: '53', orders_costed: '40',
                revenue_no_vat: '100', revenue_costed: '80',
                materials: '30', salary: '10', salary_taxes: '2.8', other_costs: '1',
                profit: '8', margin_pct: '10',
            },
        ]);
        const { executeTsehTool } = await import('@/lib/shtab/tseh-tools');
        const res: any = await executeTsehTool('tseh_profit_history', { months: 1 });
        expect(res.months[0]).toMatchObject({
            orders: 53, orders_costed: 40, materials: 30, salary: 10, other_costs: 1, profit: 8, margin_pct: 10,
        });
        expect(String(res.note)).toContain('orders_costed');
    });
});

describe('заполненность времени операций', () => {
    const row = (over: Record<string, unknown>) => [
        {
            ops_total: '100',
            with_norm_time: '0',
            with_avg_time: '0',
            with_date_begin: '0',
            with_date_end: '0',
            with_worker: '0',
            with_price: '100',
            first_closed: null,
            last_closed: null,
            ...over,
        },
    ];

    it('нормы заполнены — считать время можно', async () => {
        queryExternal.mockResolvedValue(row({ with_norm_time: '95' }));
        const { executeTsehTool } = await import('@/lib/shtab/tseh-tools');
        const res: any = await executeTsehTool('tseh_ops_coverage', {});
        expect(res.filled_pct['норма времени (TimeExecution)']).toBe(95);
        expect(res.verdict).toContain('считать можно');
    });

    it('норм нет, но операции закрываются датами — только фактический такт', async () => {
        queryExternal.mockResolvedValue(row({ with_date_end: '90', with_date_begin: '90' }));
        const { executeTsehTool } = await import('@/lib/shtab/tseh-tools');
        const res: any = await executeTsehTool('tseh_ops_coverage', {});
        expect(res.verdict).toContain('по фактическим датам');
    });

    it('ни норм, ни дат — из ЦехУспеха цеховое время не достаётся', async () => {
        queryExternal.mockResolvedValue(row({}));
        const { executeTsehTool } = await import('@/lib/shtab/tseh-tools');
        const res: any = await executeTsehTool('tseh_ops_coverage', {});
        expect(res.verdict).toContain('не достаются');
    });
});

describe('поиск по логике ЦехУспеха', () => {
    it('работает даже когда база цеха не подключена', async () => {
        delete process.env.SHTAB_DB_TSEH_URL;
        const { TSEH_TOOL_NAMES } = await import('@/lib/shtab/tseh-tools');
        // Код лежит в нашей базе: объяснить, как считается прибыль, Тамара
        // должна и при недоступном MySQL цеха.
        expect(TSEH_TOOL_NAMES.has('tseh_logic')).toBe(true);
    });

    it('пустой вопрос отсекается до похода за эмбеддингом', async () => {
        const { executeTsehTool } = await import('@/lib/shtab/tseh-tools');
        const res: any = await executeTsehTool('tseh_logic', { query: '   ' });
        expect(res.available).toBe(false);
    });
});

describe('подключение к Тамаре', () => {
    it('цеховые инструменты видны в общем списке и маршрутизируются', async () => {
        const { SHTAB_TOOLS, SHTAB_TOOL_NAMES, executeShtabTool } = await import('@/lib/shtab/tamara-tools');
        const names = SHTAB_TOOLS.map((t: any) => t.function.name);
        expect(names).toContain('tseh_balance_history');
        expect(names).toContain('money_in');
        expect(new Set(names).size).toBe(names.length);
        expect(SHTAB_TOOL_NAMES.has('tseh_debt')).toBe(true);

        queryExternal.mockResolvedValue([{ debt: '1' }]);
        const res: any = await executeShtabTool('tseh_debt', {});
        expect(res.debt).toBe(1);
    });
});
