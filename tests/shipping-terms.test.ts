/**
 * Условия отгрузки в КП и счёте.
 *
 * При самовывозе в документе должно быть написано, откуда забирать: иначе
 * менеджер вписывает наш адрес в «Адрес доставки» руками (Ирина Гордеева
 * 12.10.2026).
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('@/utils/supabase', () => ({
    supabase: {
        from: () => ({
            select: () => ({
                eq: () => ({
                    eq: () => ({ maybeSingle: async () => ({ data: { item_name: 'Самовывоз' } }) }),
                }),
            }),
        }),
    },
}));

const { shippingTermsForTest } = await import('@/lib/own-crm/documents');

describe('условия отгрузки', () => {
    it('самовывоз без адреса — печатаем адрес нашего юрлица', async () => {
        const text = await shippingTermsForTest({ code: 'self-delivery' }, 'г. Тольятти, ул. Ботаническая, 30А');
        expect(text).toBe('Самовывоз, г. Тольятти, ул. Ботаническая, 30А');
    });

    it('габариты из заказа печатаются следом за адресом склада', async () => {
        const text = await shippingTermsForTest(
            { code: 'self-delivery', address: { text: 'Транспортные габариты: 2 места 1,1×0,55×0,35 = 45 кг' } },
            'г. Тольятти, ул. Ботаническая, 30А',
        );
        expect(text).toBe('Самовывоз, г. Тольятти, ул. Ботаническая, 30А, Транспортные габариты: 2 места 1,1×0,55×0,35 = 45 кг');
    });

    it('адрес склада, вписанный менеджером руками, не задваивается', async () => {
        const text = await shippingTermsForTest(
            { code: 'self-delivery', address: { text: 'г.Тольятти, ул. Ботаническая 30 А. Габариты: 2 места' } },
            'г. Тольятти, ул. Ботаническая, 30А',
        );
        expect(text).toBe('Самовывоз, г.Тольятти, ул. Ботаническая 30 А. Габариты: 2 места');
    });

    it('не самовывоз — наш адрес не подставляется (в моке у способа одно имя)', async () => {
        const text = await shippingTermsForTest({ code: 'tk' }, 'г. Тольятти, ул. Ботаническая, 30А');
        expect(text).not.toContain('Ботаническая');
    });
});
