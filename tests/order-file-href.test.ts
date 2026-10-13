/**
 * Адрес файла заказа.
 *
 * Два экрана звали параметр `filename`, а маршрут ждёт `name`: имя не
 * доезжало, и в окне просмотра был знак вопроса вместо картинки
 * (11.10.2026). Адрес строит одна функция — проверяем именно её.
 */
import { describe, it, expect } from 'vitest';
import { orderFileHref } from '@/lib/orders/file-href';

describe('адрес файла заказа', () => {
    it('вложение письма зовётся параметром name', () => {
        const href = orderFileHref({ orderNumber: '54755', emailId: 'abc', name: 'photo 1.jpg' });
        expect(href).toContain('emailId=abc');
        expect(href).toContain('name=photo%201.jpg');
        expect(href).not.toContain('filename=');
    });

    it('файл заказа — по его номеру', () => {
        expect(orderFileHref({ orderNumber: 54755, fileId: 12 }))
            .toBe('/api/orders/54755/files/download?fileId=12');
    });

    it('кириллический номер заказа кодируется', () => {
        expect(orderFileHref({ orderNumber: '1020А', fileId: 7 })).toContain('/api/orders/1020%D0%90/');
    });
});
