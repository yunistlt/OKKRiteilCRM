import { describe, expect, it } from 'vitest';
import { latestComment, parseComment, prependComment, stampComment } from '@/lib/own-crm/comment-entries';

describe('лента комментариев менеджера', () => {
    // Время в метке московское, поэтому и ждём московское.
    const at = new Date('2026-10-05T14:30:00+03:00');

    it('ставит метку с датой, временем и автором', () => {
        expect(stampComment('недозвон', 'Гордеева Ирина', at)).toBe('05.10.2026 14:30 Гордеева Ирина: недозвон');
    });

    it('кладёт новую запись наверх', () => {
        const before = '01.10.2026 09:00 Гордеева Ирина: созвон';
        expect(prependComment(before, 'отправила счёт', 'Гордеева Ирина', at).split('\n')[0])
            .toBe('05.10.2026 14:30 Гордеева Ирина: отправила счёт');
    });

    it('читает старые записи без времени и без автора', () => {
        const entries = parseComment('29.09.2026 приостановка счетов\n05.10.2026 14:30 Гордеева Ирина: недозвон');
        expect(entries[0].text).toBe('недозвон');
        expect(entries[1].text).toBe('приостановка счетов');
    });

    it('не теряет текст, который писали как придётся', () => {
        const entries = parseComment('предприятие Росатом\nтехническое задание');
        expect(entries).toHaveLength(1);
        expect(entries[0].at).toBeNull();
        expect(entries[0].text).toContain('Росатом');
    });

    it('самая свежая запись — первая', () => {
        const text = '01.10.2026 09:00 Ирина: созвон\n05.10.2026 14:30 Ирина: счёт';
        expect(latestComment(text)?.text).toBe('счёт');
    });
});

describe('старые записи без года', () => {
    it('разбирает «29.09 созвон» и «01.10недозвон»', () => {
        const entries = parseComment('29.09 созвон\n01.10недозвон');
        expect(entries).toHaveLength(2);
        expect(entries[0].text).toBe('недозвон');
        expect(entries[1].text).toBe('созвон');
    });
});
