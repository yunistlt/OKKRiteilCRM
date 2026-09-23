import { describe, expect, it } from 'vitest';
import { formatStructure, makesCycle } from '@/lib/shtab/structure';
import type { StructurePost } from '@/lib/shtab/structure';

const post = (id: number, title: string, parent_id: number | null, extra: Partial<StructurePost> = {}): StructurePost => ({
    id,
    title,
    area_code: null,
    ideal_scene: '',
    statistic: '',
    holder_name: '',
    external_uid: null,
    ordinal: 0,
    parent_id,
    pos_x: 0,
    pos_y: 0,
    vkp: '',
    duties: '',
    ...extra,
});

describe('кольца в подчинении', () => {
    const tree = [post(1, 'Владелец', null), post(2, 'Цех', 1), post(3, 'Участок', 2)];

    it('обычное подчинение проходит', () => {
        expect(makesCycle(tree, 3, 1)).toBe(false);
        expect(makesCycle(tree, 2, null)).toBe(false);
    });

    it('сам себе начальник — кольцо', () => {
        expect(makesCycle(tree, 2, 2)).toBe(true);
    });

    it('подчинить начальника своему подчинённому — кольцо', () => {
        // Без этой проверки обход дерева зациклился бы на первом же чтении.
        expect(makesCycle(tree, 1, 3)).toBe(true);
    });
});

describe('структура текстом для Тамары', () => {
    it('печатается деревом с отступами', () => {
        const text = formatStructure(
            [
                post(1, 'Владелец', null, { holder_name: 'Иванов' }),
                post(2, 'Цех', 1, { vkp: 'изделия в срок', statistic: 'сдача с первого предъявления' }),
            ],
            [{ post_id: 2, title: 'Должностная инструкция' }],
        );
        expect(text).toContain('— Владелец [id 1]');
        expect(text).toContain('  держит: Иванов');
        expect(text).toContain('  — Цех [id 2]');
        expect(text).toContain('    ЦКП: изделия в срок');
        expect(text).toContain('    документы: Должностная инструкция');
    });

    it('пустая структура говорит, что она пустая', () => {
        expect(formatStructure([], [])).toContain('ещё не заведена');
    });

    it('пост с потерянным начальником не пропадает молча', () => {
        // Иначе владелец увидел бы схему без куска и не понял бы, почему.
        const text = formatStructure([post(5, 'Сирота', 999)], []);
        expect(text).toContain('Сирота');
        expect(text).toContain('подчинение потеряно');
    });

    it('кольцо в данных не зацикливает печать', () => {
        // Триггер в базе такого не пустит, но читающий код не должен зависать
        // ни при каких данных.
        const text = formatStructure([post(1, 'А', 2), post(2, 'Б', 1)], []);
        expect(typeof text).toBe('string');
    });
});
