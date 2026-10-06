/**
 * Фото товара возим через российский сервер: сайт zmktlt.ru отвечает только
 * российским адресам, и напрямую картинка не доходила ни в карточку заказа, ни
 * в КП клиенту (разбор 06.10.2026).
 */
import { describe, it, expect, afterEach } from 'vitest';
import { proxiedImageUrl } from '../lib/own-crm/catalog-image';

const SITE_IMAGE = 'https://www.zmktlt.ru/wa-data/public/shop/products/61/85/28561/images/49166/49166.750x0.jpg';

afterEach(() => { delete process.env.CATALOG_IMAGE_PROXY_BASE; });

describe('адрес фото товара', () => {
    it('ведёт на наш сервер, путь картинки сохраняется', () => {
        process.env.CATALOG_IMAGE_PROXY_BASE = 'https://erp.zmksoft.ru';

        expect(proxiedImageUrl(SITE_IMAGE)).toBe(
            'https://erp.zmksoft.ru/wa-data/public/shop/products/61/85/28561/images/49166/49166.750x0.jpg',
        );
    });

    it('без настроенного сервера остаётся прежним — в России работает и напрямую', () => {
        expect(proxiedImageUrl(SITE_IMAGE)).toBe(SITE_IMAGE);
    });

    it('чужие адреса не трогает', () => {
        process.env.CATALOG_IMAGE_PROXY_BASE = 'https://erp.zmksoft.ru';

        expect(proxiedImageUrl('https://example.com/wa-data/foto.jpg')).toBe('https://example.com/wa-data/foto.jpg');
    });

    it('у своего хоста пропускает только медиафайлы магазина', () => {
        process.env.CATALOG_IMAGE_PROXY_BASE = 'https://erp.zmksoft.ru';

        // Через нас не должно ходить ничего, кроме картинок товаров.
        expect(proxiedImageUrl('https://zmktlt.ru/login/')).toBe('https://zmktlt.ru/login/');
    });

    it('пустое значение остаётся пустым', () => {
        expect(proxiedImageUrl('')).toBeNull();
        expect(proxiedImageUrl(null)).toBeNull();
    });
});
