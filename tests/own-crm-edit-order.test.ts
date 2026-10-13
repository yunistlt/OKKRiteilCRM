/**
 * Правка заказа: не пускаем заведомо неверный состав и пишем только в свою
 * базу — наружу (в RetailCRM) не ходим ни при каком заказе.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { state } = vi.hoisted(() => ({
    state: { saved: null as any, fetched: [] as string[] },
}));

vi.mock('@/utils/supabase', () => {
    const chain = (row: any) => {
        const c: any = {
            eq: () => c,
            maybeSingle: async () => ({ data: row, error: null }),
            then: (r: any) => r({ data: [row], error: null }),
        };
        return c;
    };
    return {
        supabase: {
            from: () => ({
                select: () => chain({ id: 1, order_id: 54779, number: '54779', site: 'zmktlt-ru-admin', raw_payload: {} }),
                update: (patch: any) => {
                    state.saved = patch;
                    return { eq: async () => ({ error: null }) };
                },
            }),
        },
    };
});

import { editOrder, validateItems, describeEdit } from '@/lib/own-crm/edit-order';

beforeEach(() => {
    state.saved = null;
    state.fetched = [];
    // Любое обращение наружу в этом пути — ошибка: RetailCRM архив на чтение.
    global.fetch = (async (url: any) => {
        state.fetched.push(String(url));
        throw new Error('Наружу ходить нельзя');
    }) as any;
});

describe('проверка состава', () => {
    it('пустой состав пропускаем: заявка приходит до просчёта', () => {
        expect(validateItems([])).toEqual([]);
    });

    it('показываем номер проблемной позиции', () => {
        const problems = validateItems([
            { name: 'Шкаф', quantity: 1, price: 100 },
            { name: '', quantity: 0, price: -1 },
        ]);
        expect(problems.join(' ')).toContain('Позиция 2');
        expect(problems.join(' ')).not.toContain('Позиция 1');
    });
});

describe('правка заказа', () => {
    it('сохраняется в нашей базе', async () => {
        const result = await editOrder(1, { managerComment: 'проверка' });
        expect(result).toEqual({ ok: true, changed: ['комментарий менеджера'] });
        expect(state.saved?.raw_payload?.managerComment).toBe('проверка');
    });

    it('в RetailCRM не пишет', async () => {
        await editOrder(1, { managerComment: 'проверка', statusCode: 'novyi-1' });
        expect(state.fetched).toEqual([]);
    });

    it('перечисляет, что именно поменяли', () => {
        expect(describeEdit({ items: [], statusCode: 'novyi-1' })).toEqual(['состав заказа', 'статус']);
    });
});
