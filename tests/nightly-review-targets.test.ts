/**
 * Ночная переоценка берёт только тех, кого есть смысл пересчитывать.
 *
 * Повод. 17.10.2026 в очереди лежало 1 159 работ на пересчёт баллов, и 1 157 из
 * них поставила ночная сверка: она обходила все 1 377 заказов в рабочих статусах
 * подряд, случилось по ним что-то или нет. Разобрать столько было некому, и
 * очередь росла каждую ночь.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

type Row = Record<string, any>;
const state: { history: Row[] } = { history: [] };

vi.mock('@/utils/supabase', () => {
    const from = () => {
        let since = '';
        let descending = false;
        let max = Infinity;

        const query: any = {
            select: () => query,
            gte(_column: string, value: string) {
                since = value;
                return query;
            },
            order(_column: string, options?: { ascending?: boolean }) {
                descending = options?.ascending === false;
                return query;
            },
            limit(value: number) {
                max = value;
                return query;
            },
            then(resolve: any) {
                const rows = state.history
                    .filter((row) => String(row.occurred_at) >= since)
                    .sort((a, b) => {
                        const left = String(a.occurred_at);
                        const right = String(b.occurred_at);
                        return (left < right ? -1 : left > right ? 1 : 0) * (descending ? -1 : 1);
                    })
                    .slice(0, max);
                return resolve({ data: rows, error: null });
            },
        };

        return query;
    };

    return { supabase: { from } };
});

const morning = vi.hoisted(() => ({ run: vi.fn() }));
vi.mock('@/lib/sales-rop/service', () => ({ runMorning: morning.run }));

const { getOrdersWithRecentEvents, getPlannedOrderIds } = await import('@/lib/nightly-review-targets');

const NOW = new Date('2026-10-17T20:30:00Z');

beforeEach(() => {
    state.history = [];
    morning.run.mockReset();
});

describe('кого ночная сверка шлёт на переоценку', () => {
    it('берёт заказы с событиями, нетронутые не трогает', async () => {
        state.history = [
            { retailcrm_order_id: 54607, occurred_at: '2026-10-17T18:00:00Z' },
            { retailcrm_order_id: 54316, occurred_at: '2026-10-17T12:00:00Z' },
            // Событие недельной давности — заказ пересчитывать незачем.
            { retailcrm_order_id: 40001, occurred_at: '2026-10-10T12:00:00Z' },
        ];

        const orders = await getOrdersWithRecentEvents(0, 100, NOW);

        expect(orders).toEqual([54607, 54316]);
    });

    it('один заказ попадает один раз, сколько бы правок по нему ни было', async () => {
        state.history = [
            { retailcrm_order_id: 54607, occurred_at: '2026-10-17T18:00:00Z' },
            { retailcrm_order_id: 54607, occurred_at: '2026-10-17T17:00:00Z' },
            { retailcrm_order_id: 54607, occurred_at: '2026-10-17T16:00:00Z' },
            { retailcrm_order_id: 54316, occurred_at: '2026-10-17T15:00:00Z' },
        ];

        const orders = await getOrdersWithRecentEvents(0, 100, NOW);

        expect(orders).toEqual([54607, 54316]);
    });

    it('свежие события идут первыми', async () => {
        state.history = [
            { retailcrm_order_id: 1, occurred_at: '2026-10-17T08:00:00Z' },
            { retailcrm_order_id: 2, occurred_at: '2026-10-17T19:00:00Z' },
            { retailcrm_order_id: 3, occurred_at: '2026-10-17T14:00:00Z' },
        ];

        expect(await getOrdersWithRecentEvents(0, 100, NOW)).toEqual([2, 3, 1]);
    });

    it('отдаёт очередную пачку, не повторяя предыдущую', async () => {
        state.history = [1, 2, 3, 4, 5].map((id, index) => ({
            retailcrm_order_id: id,
            occurred_at: `2026-10-17T1${9 - index}:00:00Z`,
        }));

        expect(await getOrdersWithRecentEvents(0, 2, NOW)).toEqual([1, 2]);
        expect(await getOrdersWithRecentEvents(2, 2, NOW)).toEqual([3, 4]);
        expect(await getOrdersWithRecentEvents(4, 2, NOW)).toEqual([5]);
    });

    it('пустая история — пустой список, а не весь рабочий перечень', async () => {
        expect(await getOrdersWithRecentEvents(0, 100, NOW)).toEqual([]);
    });
});

describe('заказы плана дня', () => {
    it('считает план на завтрашний день и ничего не пишет', async () => {
        morning.run.mockResolvedValue({ orderIds: [54316, 54607] });

        const orders = await getPlannedOrderIds(NOW);

        expect(orders).toEqual([54316, 54607]);
        // 17.10 20:30 UTC — это уже вечер; план нужен на 18-е по заводскому времени.
        expect(morning.run).toHaveBeenCalledWith('2026-10-18', { dryRun: true });
    });

    it('план без заказов не роняет сверку', async () => {
        morning.run.mockResolvedValue({ orderIds: undefined });

        expect(await getPlannedOrderIds(NOW)).toEqual([]);
    });
});
