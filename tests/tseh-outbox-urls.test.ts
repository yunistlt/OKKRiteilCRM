import { describe, expect, it } from 'vitest';
import { tsehUrl } from '@/lib/own-crm/tseh-outbox';

/**
 * Адреса фото и карточки товара для ЦехУспеха (ТЗ 12.10.2026).
 * Картинку тянет браузер сотрудника завода, а не сервер, поэтому адрес должен быть
 * абсолютным и укладываться в предел поля — иначе лучше пустое, оно ничего не затирает.
 */
describe('адрес товара для ЦехУспеха', () => {
    it('пропускает абсолютный https-адрес', () => {
        const url = 'https://okk.zmksoft.com/wa-data/public/shop/products/49166/49166.750x0.jpg';
        expect(tsehUrl(url, 255)).toBe(url);
    });

    it('не пропускает относительный путь и http', () => {
        expect(tsehUrl('/wa-data/public/shop/49166.jpg', 255)).toBeNull();
        expect(tsehUrl('http://www.zmktlt.ru/catalog/shkaf', 512)).toBeNull();
    });

    it('не обрезает слишком длинный адрес, а выбрасывает его', () => {
        expect(tsehUrl(`https://okk.zmksoft.com/${'a'.repeat(300)}.jpg`, 255)).toBeNull();
    });

    it('пустое и отсутствующее значение — пусто', () => {
        expect(tsehUrl(null, 255)).toBeNull();
        expect(tsehUrl('   ', 255)).toBeNull();
    });
});
