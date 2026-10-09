/**
 * Кнопка «Посмотрите наш каталог продукции» — в каждом письме клиенту.
 *
 * Проверяем на уровне подписи: она приклеивается ко всем письмам (ответ в
 * переписку, письмо по шаблону, рассылка), поэтому кнопка живёт там же, а не
 * в одиннадцати шаблонах, семь из которых пишет модель.
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('@/utils/supabase', () => ({
    supabase: {
        from: () => ({
            select: () => ({
                eq: () => ({
                    maybeSingle: async () => ({
                        data: { first_name: 'Ирина', last_name: 'Гордеева', telphin_extension: '119' },
                        error: null,
                    }),
                }),
            }),
        }),
    },
}));

import { managerSignature, withSignature } from '@/lib/templates/signature';

describe('каталог в письме', () => {
    it('кнопка есть в письме с подписью', async () => {
        const sig = await managerSignature(119);
        const html = withSignature('<p>Счёт во вложении.</p>', sig, true);

        expect(html).toContain('ПОСМОТРИТЕ НАШ КАТАЛОГ ПРОДУКЦИИ');
        expect(html).toContain('/katalog');
        expect(html).toContain('Гордеева');
    });

    it('в простом тексте — строкой со ссылкой', async () => {
        const sig = await managerSignature(119);
        const text = withSignature('Счёт во вложении.', sig, false);

        expect(text).toContain('ПОСМОТРИТЕ НАШ КАТАЛОГ ПРОДУКЦИИ: ');
        expect(text).toContain('/katalog');
    });

    it('без менеджера письмо всё равно с каталогом', () => {
        const text = withSignature('Здравствуйте!', null, false);
        expect(text).toContain('/katalog');
    });

    it('своя подпись модели не удваивается', async () => {
        const sig = await managerSignature(119);
        const text = withSignature('Текст.\n\nС уважением,\nбот', sig, false);
        expect(text.match(/С уважением/g)).toHaveLength(1);
    });
});
