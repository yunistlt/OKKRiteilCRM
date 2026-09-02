import { describe, expect, it } from 'vitest';
import { formatHistory, formatKnowledge, renderTemplate, weekStart } from '@/lib/shtab/tamara';

describe('weekStart — к какой неделе относится сводка', () => {
    it('понедельник — сам себе начало недели', () => {
        expect(weekStart(new Date('2026-08-24T06:00:00Z'))).toBe('2026-08-24');
    });

    it('середина недели отматывается к своему понедельнику', () => {
        expect(weekStart(new Date('2026-08-26T23:59:59Z'))).toBe('2026-08-24');
        expect(weekStart(new Date('2026-08-28T12:00:00Z'))).toBe('2026-08-24');
    });

    it('воскресенье относится к прошедшей неделе, а не к завтрашней', () => {
        // Это как раз то место, где легко ошибиться: getUTCDay() у воскресенья
        // равен нулю, и наивная формула отправила бы его на неделю вперёд.
        expect(weekStart(new Date('2026-08-30T22:00:00Z'))).toBe('2026-08-24');
    });

    it('переход через границу месяца и года', () => {
        expect(weekStart(new Date('2026-09-02T06:00:00Z'))).toBe('2026-08-31');
        expect(weekStart(new Date('2027-01-01T06:00:00Z'))).toBe('2026-12-28');
    });

    it('внутри одной недели все дни дают один и тот же ответ', () => {
        const days = ['24', '25', '26', '27', '28', '29', '30'].map(
            (d) => weekStart(new Date(`2026-08-${d}T06:00:00Z`)),
        );
        expect(new Set(days).size).toBe(1);
    });
});

describe('подстановка в шаблон промпта', () => {
    it('подставляет значения', () => {
        expect(renderTemplate('Вопрос: {{question}}', { question: 'сколько минусов' })).toBe('Вопрос: сколько минусов');
    });

    it('неизвестное поле заменяется пустотой, а не остаётся в тексте', () => {
        // Иначе модель получила бы «{{week_data}}» и приняла бы это за данные.
        expect(renderTemplate('a {{нет}} b {{missing}} c', {})).toBe('a {{нет}} b  c');
    });

    it('одно и то же поле подставляется во все места', () => {
        expect(renderTemplate('{{x}}-{{x}}', { x: '7' })).toBe('7-7');
    });
});

describe('оформление контекста для модели', () => {
    it('без выдержек честно говорит, что их нет', () => {
        expect(formatKnowledge([])).toContain('не нашлось');
    });

    it('к каждой выдержке приложен источник', () => {
        const text = formatKnowledge([
            { slug: 'fw-toc', title: 'Теория ограничений', content: 'текст', source_ref: 'Голдратт', similarity: 0.9 },
        ]);
        expect(text).toContain('Теория ограничений');
        expect(text).toContain('Голдратт');
    });

    it('пустая история не выдаётся за состоявшийся разговор', () => {
        expect(formatHistory([])).toContain('не было');
    });

    it('роли подписаны по-русски', () => {
        const text = formatHistory([
            { role: 'user', text: 'что делать' },
            { role: 'assistant', text: 'разбирать производство' },
        ]);
        expect(text).toContain('Владелец: что делать');
        expect(text).toContain('Тамара: разбирать производство');
    });
});
