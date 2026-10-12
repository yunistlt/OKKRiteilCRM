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

    it('адрес в заказе важнее нашего: что менеджер написал, то и печатаем', async () => {
        const text = await shippingTermsForTest({ code: 'self-delivery', address: { text: 'г. Самара, склад 2' } }, 'г. Тольятти, ул. Ботаническая, 30А');
        expect(text).toBe('Самовывоз, г. Самара, склад 2');
    });

    it('не самовывоз — наш адрес не подставляется (в моке у способа одно имя)', async () => {
        const text = await shippingTermsForTest({ code: 'tk' }, 'г. Тольятти, ул. Ботаническая, 30А');
        expect(text).not.toContain('Ботаническая');
    });
});
