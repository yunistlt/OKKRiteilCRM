import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Заявка без менеджера не создаётся (требование владельца 02.10.2026).
 * Проверяем сам выбор: указанный менеджер, иначе распределение, иначе отказ —
 * но никогда «ничего».
 */

const managers = new Map<number, { active: boolean; known: boolean }>([
    [10, { active: true, known: true }],
    [98, { active: true, known: true }],
    [999, { active: true, known: false }], // админская учётка: в RetailCRM такого нет
    [777, { active: false, known: true }], // уволенный
]);

vi.mock('@/utils/supabase', () => ({
    supabase: {
        from: () => ({
            select: () => ({
                eq: (_column: string, value: unknown) => ({
                    maybeSingle: async () => {
                        const row = managers.get(Number(value));
                        return { data: row ? { id: Number(value), active: row.active, raw_data: row.known ? { id: value } : null } : null };
                    },
                }),
            }),
        }),
    },
}));

const assignMock = vi.fn();
const contextMock = vi.fn();

vi.mock('@/lib/email/assign', () => ({
    getAssignmentContext: () => contextMock(),
    resolveAssignment: (...args: unknown[]) => assignMock(...args),
}));

const { assignManagerForNewOrder } = await import('@/lib/own-crm/assign-manager');

describe('назначение менеджера новой заявке', () => {
    beforeEach(() => {
        assignMock.mockReset();
        contextMock.mockReset();
        contextMock.mockResolvedValue({ pool: [10, 98], balancePool: [10, 98], load: {}, managerNames: { 10: 'Елена', 98: 'Евгения' } });
    });

    it('указанный живой менеджер берётся как есть, распределение не трогаем', async () => {
        const result = await assignManagerForNewOrder({ managerId: 98 });
        expect(result.managerId).toBe(98);
        expect(assignMock).not.toHaveBeenCalled();
    });

    it('номер админской учётки не годится — заявку распределяем', async () => {
        assignMock.mockResolvedValue({ managerId: 10, method: 'load', reason: 'Поровну за период → Елена' });
        const result = await assignManagerForNewOrder({ managerId: 999, email: 'client@example.com' });
        expect(result.managerId).toBe(10);
        expect(result.reason).toContain('Поровну');
    });

    it('менеджер не указан вовсе — тоже распределяем', async () => {
        assignMock.mockResolvedValue({ managerId: 98, method: 'history', reason: 'Клиент известен' });
        const result = await assignManagerForNewOrder({ phone: '+79312972026' });
        expect(result.managerId).toBe(98);
    });

    it('распределение назвало уволенного — берём живого из пула', async () => {
        assignMock.mockResolvedValue({ managerId: 777, method: 'load', reason: 'Поровну за период' });
        const result = await assignManagerForNewOrder({});
        expect([10, 98]).toContain(result.managerId);
    });

    it('пул пуст — отказ с понятным текстом, а не заказ без менеджера', async () => {
        contextMock.mockResolvedValue({ pool: [], balancePool: [], load: {}, managerNames: {} });
        await expect(assignManagerForNewOrder({})).rejects.toThrow(/пул менеджеров пуст/i);
    });
});
