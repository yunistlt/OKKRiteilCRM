import { describe, expect, it } from 'vitest';
import { isReasoningModel } from '@/lib/shtab/tamara';
import { formatFiles, formatMemory, formatSummary, formatTail, titleFromQuestion } from '@/lib/shtab/tamara-chat';

describe('выбор способа обращения к модели', () => {
    it('семейства gpt-5 и o опознаются как рассуждающие', () => {
        // Не опознали — уйдёт max_tokens, и запрос вернёт 400: разговор
        // перестанет работать целиком, а не деградирует.
        for (const m of ['gpt-5.5', 'gpt-5.4-mini', 'o3', 'o4-mini', 'GPT-5.5']) {
            expect(isReasoningModel(m), m).toBe(true);
        }
    });

    it('обычные модели остаются обычными', () => {
        for (const m of ['gpt-4o', 'gpt-4.1', 'gpt-4o-mini']) {
            expect(isReasoningModel(m), m).toBe(false);
        }
    });
});

describe('название разговора', () => {
    it('берётся из первого вопроса и режется по длине', () => {
        expect(titleFromQuestion('  Почему падает   конверсия? ')).toBe('Почему падает конверсия?');
        const long = titleFromQuestion('я'.repeat(200));
        expect(long.length).toBe(48);
        expect(long.endsWith('…')).toBe(true);
    });
});

describe('контекст для модели', () => {
    it('пустые части не молчат, а говорят, что пусто', () => {
        // Пустая строка в шаблоне выглядит как оборванный контекст: модель
        // начинает додумывать, что там было.
        expect(formatTail([])).toContain('только начинается');
        expect(formatMemory([])).toContain('не отложилось');
        expect(formatSummary(null)).toContain('Пересказа пока нет');
    });

    it('хвост разговора подписан ролями по-человечески', () => {
        const text = formatTail([
            { id: 1, chat_id: 1, role: 'user', text: 'вопрос', used_tools: [], created_at: '' },
            { id: 2, chat_id: 1, role: 'assistant', text: 'ответ', used_tools: [], created_at: '' },
        ]);
        expect(text).toBe('Владелец: вопрос\n\nТамара: ответ');
    });

    it('память печатается с видом факта, а не голым списком', () => {
        const text = formatMemory([
            { id: 1, fact: 'ядро из шести человек', kind: 'context', created_at: '', similarity: 0.9 },
            { id: 2, fact: 'писать коротко', kind: 'preference', created_at: '', similarity: 0.8 },
        ]);
        expect(text).toContain('[обстоятельство] ядро из шести человек');
        expect(text).toContain('[как работать] писать коротко');
    });
});

describe('файлы, приложенные к разговору', () => {
    it('без файлов контекст говорит, что их нет', () => {
        expect(formatFiles([])).toContain('не приложено');
    });

    it('нечитаемый файл назван нечитаемым, а не пропущен', () => {
        // Пропустить его молча — значит дать Тамаре решить, что в документе
        // ничего нет, хотя она его просто не открыла.
        const text = formatFiles([{ title: 'Скан приказа', file_name: 'prikaz.pdf', text_content: '   ' }]);
        expect(text).toContain('текст не извлёкся');
    });

    it('длинный файл режется и об этом сказано', () => {
        const text = formatFiles([{ title: 'Договор', file_name: 'd.pdf', text_content: 'я'.repeat(20000) }]);
        expect(text).toContain('показано начало из 20 000 знаков'.replace(/\s/g, ' ').replace('20 000', '20000'));
        expect(text.length).toBeLessThan(13000);
    });
});
