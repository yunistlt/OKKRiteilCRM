import { describe, it, expect } from 'vitest';
import { itemAccent, itemLabel, taskSourceOf } from '@/lib/notifications/items';

const lena = { id: '42', email: 'elena-parfenova82@mail.ru', first_name: 'Елена', last_name: 'Парфёнова' };

describe('чья задача в ленте оповещений', () => {
    it('системную узнаём по источнику, а не по подписи', () => {
        // Задачу про ИНН ставила система, но подписана она тем, кто двигал статус.
        const task = { source: 'system', created_by: 'Система', created_by_user_id: null };
        expect(taskSourceOf(task, lena)).toBe('system');
    });

    it('старая системная задача подписана человеком — источник всё равно главнее', () => {
        const task = { source: 'system', created_by: 'Елена Парфёнова', created_by_user_id: null };
        expect(taskSourceOf(task, lena)).toBe('system');
    });

    it('свою задачу узнаём по автору', () => {
        const task = { source: 'manager', created_by: 'Елена Парфёнова', created_by_user_id: '42' };
        expect(taskSourceOf(task, lena)).toBe('mine');
    });

    it('задача коллеги на моём заказе — не моя', () => {
        const task = { source: 'manager', created_by: 'Ирина Гордеева', created_by_user_id: '7' };
        expect(taskSourceOf(task, lena)).toBe('colleague');
    });

    it('у старых задач автора нет — сверяемся с почтой, которой их подписывали', () => {
        const task = { source: 'manager', created_by: 'elena-parfenova82@mail.ru', created_by_user_id: null };
        expect(taskSourceOf(task, lena)).toBe('mine');
    });

    it('у старых задач автора нет — сверяемся и с фамилией', () => {
        const task = { source: 'manager', created_by: 'Елена Парфёнова', created_by_user_id: null };
        expect(taskSourceOf(task, lena)).toBe('mine');
    });

    it('чужая почта в старой задаче своей её не делает', () => {
        const task = { source: 'manager', created_by: 'irinagordeeva@mail.ru', created_by_user_id: null };
        expect(taskSourceOf(task, lena)).toBe('colleague');
    });
});

describe('как задача выглядит в списке', () => {
    const row = (taskSource: 'mine' | 'colleague' | 'system') => ({
        id: '1', kind: 'task' as const, at: '2026-11-01T10:00:00Z',
        text: 'перезвонить', note: null, orderNumber: '900060', read: false, taskSource,
    });

    it('называется по-человечески', () => {
        expect(itemLabel(row('mine'))).toBe('Моя задача');
        expect(itemLabel(row('system'))).toBe('Задача системы');
        expect(itemLabel(row('colleague'))).toBe('Задача');
    });

    it('своя задача помечена цветом, письмо — нет', () => {
        expect(itemAccent(row('mine'))).toContain('amber');
        expect(itemAccent({ ...row('mine'), kind: 'mail' })).toBe('');
    });
});
