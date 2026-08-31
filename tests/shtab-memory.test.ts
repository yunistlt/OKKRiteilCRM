import { describe, it, expect } from 'vitest';
import { MEMORY_LIMIT, NOTE_MAX, factBody, formatMemory, topicSlug, trimNote } from '@/lib/shtab/memory';
import type { MemoryRow } from '@/lib/shtab/memory';

// Проверяется то, от чего зависит правило «спросил один раз»: устойчивость slug,
// граница памяти и честность формулировок в блоке для промпта.

function row(over: Partial<MemoryRow> = {}): MemoryRow {
    return {
        id: 1,
        topic: 'начальники цеха',
        note: 'их двое: по производству и по качеству с ТПП',
        kb_slug: 'company-nachalniki-ceha',
        asked: 'Сколько в цехе начальников и за что каждый отвечает?',
        source: 'owner',
        created_at: new Date('2026-08-31T10:00:00Z').toISOString(),
        ...over,
    };
}

describe('topicSlug', () => {
    it('транслитерирует кириллицу', () => {
        expect(topicSlug('начальники цеха')).toBe('company-nachalniki-ceha');
    });

    it('устойчив: одна и та же тема в разном регистре даёт один slug', () => {
        // Иначе повторный ответ по теме завёл бы вторую запись, и Тамара
        // выбирала бы между двумя «фактами» об одном и том же.
        expect(topicSlug('Печать ярлыков')).toBe(topicSlug('печать ЯРЛЫКОВ'));
    });

    it('схлопывает знаки и пробелы в один дефис, без хвостов', () => {
        expect(topicSlug('  маршрут —  изделия!!  ')).toBe('company-marshrut-izdeliya');
    });

    it('возвращает пустоту, если из темы не осталось букв', () => {
        // Пустой slug — отказ записать. Подставить «company-» нельзя: две такие
        // темы столкнулись бы в один slug и второй факт затёр бы первый.
        expect(topicSlug('!!! ???')).toBe('');
        expect(topicSlug('')).toBe('');
    });

    it('не выходит за длину, на которой slug ещё читается', () => {
        const slug = topicSlug('о'.repeat(300));
        expect(slug.length).toBeLessThanOrEqual('company-'.length + 60);
    });
});

describe('trimNote', () => {
    it('схлопывает переносы: отметка занимает одну строку промпта', () => {
        expect(trimNote('двое\n\n  по производству ')).toBe('двое по производству');
    });

    it('режет по пределу и показывает, что обрезано', () => {
        const cut = trimNote('я'.repeat(NOTE_MAX + 50));
        expect(cut.length).toBe(NOTE_MAX);
        expect(cut.endsWith('…')).toBe(true);
    });

    it('короткую не трогает', () => {
        expect(trimNote('их двое')).toBe('их двое');
    });
});

describe('factBody', () => {
    const at = new Date('2026-08-31T12:00:00Z');

    it('кладёт ответ владельца дословно и помечает его как его слова', () => {
        const body = factBody(
            { topic: 'начальники цеха', asked: 'Сколько начальников?', answer: 'Двое: по производству и по качеству.' },
            at,
        );
        expect(body).toContain('Двое: по производству и по качеству.');
        expect(body).toContain('со слов владельца, 2026-08-31');
    });

    it('включает вопрос: владелец должен видеть, на что отвечал', () => {
        expect(factBody({ topic: 'т', asked: 'Печатаются ли ярлыки?', answer: 'Да' }, at)).toContain('Печатаются ли ярлыки?');
    });

    it('различает источник — со слов владельца и из ЦехУспеха', () => {
        const tseh = factBody({ topic: 'т', asked: 'в', answer: 'о', source: 'tseh' }, at);
        expect(tseh).toContain('из ЦехУспеха');
        expect(tseh).not.toContain('со слов владельца');
    });

    it('не теряет ответ, если вопрос не задавался', () => {
        const body = factBody({ topic: 'т', asked: '', answer: 'сам сказал' }, at);
        expect(body).toContain('Вопрос: —');
        expect(body).toContain('сам сказал');
    });
});

describe('formatMemory', () => {
    const now = new Date('2026-09-05T10:00:00Z');

    it('на пустой памяти прямо говорит, что не выяснено ничего', () => {
        // Пустой блок модель прочитала бы как «памяти нет вообще» и молчала бы
        // про вопросы. Здесь нужна не пустота, а указание спрашивать.
        const out = formatMemory([], now);
        expect(out).toContain('Пусто');
        expect(out).toContain('спроси владельца');
    });

    it('печатает тему, отметку и slug — по slug факт достают напрямую', () => {
        const out = formatMemory([row()], now);
        expect(out).toContain('начальники цеха');
        expect(out).toContain('их двое');
        expect(out).toContain('company-nachalniki-ceha');
    });

    it('показывает возраст факта, а не только его самого', () => {
        // Факт годовой давности и вчерашний — разного веса. Без возраста модель
        // считает всю память одинаково свежей и подставляет устаревшее молча.
        expect(formatMemory([row()], now)).toContain('5 дн. назад');
        expect(formatMemory([row({ created_at: new Date('2026-09-05T08:00:00Z').toISOString() })], now)).toContain('сегодня');
        expect(formatMemory([row({ created_at: new Date('2026-09-04T08:00:00Z').toISOString() })], now)).toContain('вчера');
    });

    it('запрещает повторный вопрос по теме, которая уже в памяти', () => {
        expect(formatMemory([row()], now)).toContain('повторно не спрашивай');
    });

    it('называет источник у каждой строки', () => {
        expect(formatMemory([row({ source: 'tseh' })], now)).toContain('со слов: tseh');
    });
});

describe('границы памяти', () => {
    it('память ограничена по числу строк', () => {
        // Она грузится в каждый запрос. Без границы через полгода вытеснит
        // собственно разговор, и виновато будет не количество фактов.
        expect(MEMORY_LIMIT).toBeGreaterThan(0);
        expect(MEMORY_LIMIT).toBeLessThanOrEqual(100);
    });

    it('отметка ограничена по длине', () => {
        expect(NOTE_MAX).toBeLessThanOrEqual(300);
    });

    it('блок памяти на полном пределе остаётся обозримым', () => {
        const rows = Array.from({ length: MEMORY_LIMIT }, (_, i) =>
            row({ id: i, topic: `тема ${i}`, note: 'я'.repeat(NOTE_MAX) }),
        );
        const out = formatMemory(rows, new Date('2026-09-05T10:00:00Z'));
        expect(out.split('\n')).toHaveLength(MEMORY_LIMIT + 2);
        // грубая верхняя оценка: предел строки плюс служебная обвязка
        expect(out.length).toBeLessThan(MEMORY_LIMIT * (NOTE_MAX + 200));
    });
});
