/**
 * Правка заказа сама ставит пересчёт баллов.
 *
 * Повод. Триггеры «статус изменился» и «комментарий добавлен» жили в приёме
 * изменений из RetailCRM. Приём выключили 05.10.2026, когда ОКК стала
 * единственной системой учёта, — и пересчёт по этим событиям потерялся. Дыру
 * затыкала ночная сверка сплошным обходом всех рабочих заказов: 1 377 работ за
 * ночь при восьми разобранных за день.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const inserted: any[] = [];

vi.mock('@/utils/supabase', () => {
    const from = (table: string) => ({
        insert(rows: any[]) {
            if (table === 'order_history_log') inserted.push(...rows);
            return Promise.resolve({ error: null });
        },
    });

    return {
        supabase: {
            from,
            // Счётчик номеров записей истории.
            rpc: (_name: string, args: { count_needed: number }) =>
                Promise.resolve({ data: Array.from({ length: args.count_needed }, (_, i) => 9000 + i), error: null }),
        },
    };
});

const jobs = vi.hoisted(() => ({ enqueue: vi.fn() }));
vi.mock('@/lib/system-jobs', () => ({ safeEnqueueOrderRefreshJob: jobs.enqueue }));

const { writeOwnHistory } = await import('@/lib/own-crm/history-write');

beforeEach(() => {
    inserted.length = 0;
    jobs.enqueue.mockReset();
    jobs.enqueue.mockResolvedValue(undefined);
});

describe('пересчёт баллов после правки заказа', () => {
    it('смена статуса ставит пересчёт этого заказа', async () => {
        await writeOwnHistory(54607, [{ field: 'status', oldValue: 'new', newValue: 'send-assembling' }], 98);

        expect(jobs.enqueue).toHaveBeenCalledTimes(1);
        expect(jobs.enqueue.mock.calls[0][0]).toMatchObject({
            jobType: 'order_score_refresh',
            orderId: 54607,
            source: 'order_edit',
        });
    });

    it('комментарий менеджера ставит пересчёт', async () => {
        await writeOwnHistory(54316, [{ field: 'manager_comment', newValue: 'Клиент просит счёт' }], 98);

        expect(jobs.enqueue).toHaveBeenCalledTimes(1);
    });

    it('правка суммы и товаров очередь не тревожит', async () => {
        await writeOwnHistory(
            54607,
            [
                { field: 'summ', oldValue: '100', newValue: '200' },
                { field: 'order_product', newValue: 'Шкаф' },
            ],
            98,
        );

        expect(jobs.enqueue).not.toHaveBeenCalled();
        // История при этом записана: триггер её не подменяет.
        expect(inserted).toHaveLength(2);
    });

    it('одна правка — один пересчёт, сколько бы полей ни поменяли', async () => {
        await writeOwnHistory(
            54607,
            [
                { field: 'status', newValue: 'send-assembling' },
                { field: 'manager_comment', newValue: 'Передал в цех' },
                { field: 'summ', newValue: '200' },
            ],
            98,
        );

        expect(jobs.enqueue).toHaveBeenCalledTimes(1);
    });

    it('сорванная постановка в очередь не роняет запись истории', async () => {
        jobs.enqueue.mockRejectedValue(new Error('очередь недоступна'));

        await expect(
            writeOwnHistory(54607, [{ field: 'status', newValue: 'send-assembling' }], 98),
        ).resolves.toBeUndefined();

        expect(inserted).toHaveLength(1);
    });
});
