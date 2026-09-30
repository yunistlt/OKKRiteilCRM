/**
 * Правка заказа: не пускаем заведомо неверный состав и внятно объясняем, когда
 * править нельзя — выключен рубильник или сломан магазин в RetailCRM.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { state } = vi.hoisted(() => ({
    state: { outboundEnabled: false, crmAnswer: { success: true } as any, site: 'zmktlt-ru-admin' },
}));

vi.mock('@/utils/supabase', () => {
    const chain = (row: any) => {
        const c: any = { eq: () => c, maybeSingle: async () => ({ data: row, error: null }), then: (r: any) => r({ data: [row], error: null }) };
        return c;
    };
    return { supabase: { from: () => ({ select: () => chain({ order_id: 54779, number: '54779', site: state.site }) }) } };
});

vi.mock('@/lib/retailcrm/outbound-guard', () => ({
    isRetailcrmOutboundWriteEnabled: async () => state.outboundEnabled,
    RETAILCRM_WRITE_BLOCKED_MESSAGE: 'Отправка изменений в RetailCRM пока отключена — сначала достраиваем свой функционал.',
}));

vi.mock('@/lib/retailcrm/leads', () => ({
    getCrmConfig: async () => ({ url: 'https://crm.test', key: 'k', site: 'zmktlt-ru-admin' }),
}));

import { editOrder, validateItems, describeEdit } from '@/lib/own-crm/edit-order';

beforeEach(() => {
    state.outboundEnabled = false;
    state.crmAnswer = { success: true };
    state.site = 'zmktlt-ru-admin';
    global.fetch = (async () => ({ json: async () => state.crmAnswer })) as any;
});

describe('проверка состава', () => {
    it('пустой состав не пропускаем', () => {
        expect(validateItems([])).toContain('В заказе должна остаться хотя бы одна позиция');
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
    it('при выключенном рубильнике объясняет, а не молчит', async () => {
        const result = await editOrder(1, { managerComment: 'проверка' });
        expect(result).toEqual({ ok: false, reason: expect.stringContaining('отключена') });
    });

    it('при включённом рубильнике правка проходит', async () => {
        state.outboundEnabled = true;
        const result = await editOrder(1, { managerComment: 'проверка' });
        expect(result).toEqual({ ok: true, changed: ['комментарий менеджера'] });
    });

    it('сломанный магазин объясняем человеческим языком', async () => {
        state.outboundEnabled = true;
        state.site = 'zmktlt-ru';
        state.crmAnswer = { success: false, errorMsg: "Invalid value for parameter 'site'" };
        const result = await editOrder(1, { managerComment: 'проверка' }) as any;
        expect(result.ok).toBe(false);
        expect(result.reason).toContain('не принимает магазин');
        expect(result.reason).toContain('пока магазин не починят');
    });

    it('перечисляет, что именно поменяли', () => {
        expect(describeEdit({ items: [], statusCode: 'novyi-1' })).toEqual(['состав заказа', 'статус']);
    });
});
