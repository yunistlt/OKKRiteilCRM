/**
 * Письмо клиенту всегда подписано тем, кто его шлёт.
 *
 * Жалоба Ирины Гордеевой 05.11.2026 (доработка 81): «письмо отправлено
 * логистом, но подпись менеджера». Ответ в карточке заказа и письмо по шаблону
 * подпись ставят (`senderSignature`), а массовая рассылка уходила вовсе без
 * неё — клиент получал текст без имени, телефона и кнопки каталога.
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { withSignature } from '@/lib/templates/signature';

const read = (file: string) => fs.readFileSync(path.join(process.cwd(), file), 'utf8');

/** Все маршруты, которые шлют письмо клиенту текстом менеджера или шаблона. */
const SENDING_ROUTES = [
    'app/api/orders/bulk-email/route.ts',
    'app/api/orders/[id]/email-template/[code]/route.ts',
];

describe('подпись в исходящих письмах', () => {
    it.each(SENDING_ROUTES)('%s подписывает письмо отправителем', (file) => {
        const source = read(file);
        expect(source).toContain('senderSignature');
        expect(source).toContain('withSignature');
        // Подпись того, кто шлёт: сессия первым доводом, менеджер заказа — запасным.
        expect(source).toMatch(/senderSignature\(\s*\n?\s*session\.user\?\.retail_crm_manager_id/);
    });

    it('подпись подставляет имя отправителя, а не заказа', () => {
        const logist = { text: 'С уважением,\nСимонова Екатерина', html: 'С уважением,<br>Симонова Екатерина' };
        const letter = withSignature('<p>Отгрузка во вторник.</p>', logist, true);
        expect(letter).toContain('Симонова Екатерина');
    });

    it('письмо без подписи всё равно несёт каталог', () => {
        expect(withSignature('Текст', null, false)).toContain('ПОСМОТРИТЕ НАШ КАТАЛОГ ПРОДУКЦИИ');
    });

    it('две подписи в письме не появляются', () => {
        const sig = { text: 'С уважением,\nСимонова Екатерина', html: 'С уважением,<br>Симонова Екатерина' };
        const letter = withSignature('Отгрузка во вторник.\n\nС уважением, Евгения', sig, false);
        expect(letter.match(/С уважением/g)?.length).toBe(1);
        expect(letter).not.toContain('Евгения');
    });
});
