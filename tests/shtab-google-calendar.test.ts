import { beforeEach, describe, expect, it } from 'vitest';
import { decryptToken, encryptToken, signState, tokenKeyConfigured, verifyState } from '@/lib/shtab/google/crypto';
import { RHYTHM, firstSlot, renderAgenda, rhythmUid } from '@/lib/shtab/google/rhythm';
import { conflicts } from '@/lib/shtab/google/calendar';
import { isExpired } from '@/lib/shtab/google/oauth';

const KEY = 'test-key-для-шифрования-токенов';

beforeEach(() => {
    process.env.SHTAB_TOKEN_KEY = KEY;
});

describe('шифрование токена', () => {
    it('расшифровывается обратно', () => {
        const secret = '1//0abcDEF-refresh-token_значение';
        expect(decryptToken(encryptToken(secret))).toBe(secret);
    });

    it('два шифрования одной строки дают разный результат', () => {
        // Иначе по базе было бы видно, что два токена одинаковы.
        expect(encryptToken('одно и то же')).not.toBe(encryptToken('одно и то же'));
    });

    it('подменённый шифротекст не расшифровывается молча', () => {
        // GCM проверяет целостность: испорченная строка обязана дать ошибку, а не
        // мусор, который потом уйдёт в заголовок Authorization.
        const packed = encryptToken('секрет');
        const raw = Buffer.from(packed, 'base64');
        raw[raw.length - 1] ^= 0xff;
        expect(() => decryptToken(raw.toString('base64'))).toThrow();
    });

    it('обрывок вместо токена — понятная ошибка', () => {
        expect(() => decryptToken('короткая')).toThrow(/повреждён/);
    });

    it('без ключа не шифрует и не молчит', () => {
        delete process.env.SHTAB_TOKEN_KEY;
        expect(tokenKeyConfigured()).toBe(false);
        expect(() => encryptToken('секрет')).toThrow(/SHTAB_TOKEN_KEY/);
    });

    it('слишком короткий ключ отвергается', () => {
        process.env.SHTAB_TOKEN_KEY = 'коротко';
        expect(tokenKeyConfigured()).toBe(false);
        expect(() => encryptToken('секрет')).toThrow(/16/);
    });

    it('чужим ключом не расшифровать', () => {
        const packed = encryptToken('секрет');
        process.env.SHTAB_TOKEN_KEY = 'совершенно-другой-ключ-подлиннее';
        expect(() => decryptToken(packed)).toThrow();
    });
});

describe('подпись state для OAuth', () => {
    it('своя подпись проходит', () => {
        expect(verifyState(signState('owner'))).toBe('owner');
    });

    it('подделанная не проходит', () => {
        // Без этой проверки чужой запрос на адрес возврата привязал бы к Штабу
        // свой календарь.
        const state = signState('owner');
        expect(verifyState(state.replace(/.$/, 'X'))).toBeNull();
        expect(verifyState('произвольная строка')).toBeNull();
        expect(verifyState('')).toBeNull();
    });

    it('устаревшая не проходит', () => {
        const old = signState('owner', Date.now() - 20 * 60 * 1000);
        expect(verifyState(old)).toBeNull();
    });

    it('выданная из будущего не проходит', () => {
        const ahead = signState('owner', Date.now() + 10 * 60 * 1000);
        expect(verifyState(ahead)).toBeNull();
    });

    it('подпись, сделанная другим ключом, не проходит', () => {
        const state = signState('owner');
        process.env.SHTAB_TOKEN_KEY = 'другой-ключ-достаточной-длины';
        expect(verifyState(state)).toBeNull();
    });
});

describe('когда обновлять доступ', () => {
    const now = Date.parse('2026-08-28T10:00:00Z');

    it('свежий токен не обновляется', () => {
        expect(isExpired('2026-08-28T10:30:00Z', now)).toBe(false);
    });

    it('истёкший обновляется', () => {
        expect(isExpired('2026-08-28T09:59:00Z', now)).toBe(true);
    });

    it('обновляется заранее, с запасом на дорогу', () => {
        // Токен, живущий полминуты, до сервера Google уже не доедет.
        expect(isExpired('2026-08-28T10:00:30Z', now)).toBe(true);
    });

    it('битая дата считается истёкшей', () => {
        expect(isExpired('позавчера', now)).toBe(true);
        expect(isExpired('', now)).toBe(true);
    });
});

describe('события ритма', () => {
    it('заведены все четыре встречи', () => {
        expect(RHYTHM.map((m) => m.code)).toEqual(['daily', 'weekly', 'monthly', 'quarterly']);
    });

    it('идентификатор устойчив: повторный прогон не задваивает встречу', () => {
        // Это главное свойство: задание крутится еженедельно и обязано попадать
        // в то же событие, а не плодить новые.
        const a = rhythmUid('weekly', 'abc123@group.calendar.google.com');
        const b = rhythmUid('weekly', 'abc123@group.calendar.google.com');
        expect(a).toBe(b);
        expect(a).toMatch(/^shtab-weekly-/);
    });

    it('у разных ритмов и разных календарей идентификаторы разные', () => {
        const cal = 'abc123@group.calendar.google.com';
        expect(rhythmUid('daily', cal)).not.toBe(rhythmUid('weekly', cal));
        expect(rhythmUid('weekly', cal)).not.toBe(rhythmUid('weekly', 'zzz999@group.calendar.google.com'));
    });

    it('правила повторения соответствуют ритму', () => {
        const by = Object.fromEntries(RHYTHM.map((m) => [m.code, m.rrule]));
        expect(by.daily).toContain('BYDAY=MO,TU,WE,TH,FR');
        expect(by.weekly).toContain('FREQ=WEEKLY');
        expect(by.weekly).toContain('BYDAY=MO');
        expect(by.monthly).toContain('BYDAY=1MO');
        expect(by.quarterly).toContain('BYMONTH=1,4,7,10');
    });

    it('длительности заданы по методичке', () => {
        const by = Object.fromEntries(RHYTHM.map((m) => [m.code, m.minutes]));
        expect(by.daily).toBe(15);
        expect(by.weekly).toBe(60);
        expect(by.monthly).toBe(240);
        expect(by.quarterly).toBe(480);
    });
});

describe('первый слот встречи', () => {
    const week = '2026-08-24'; // понедельник

    it('ежедневная и недельная начинаются с понедельника недели', () => {
        expect(firstSlot('daily', week, 8)).toBe('2026-08-24T08:00:00.000Z');
        expect(firstSlot('weekly', week, 9)).toBe('2026-08-24T09:00:00.000Z');
    });

    it('месячная — первый понедельник месяца', () => {
        expect(firstSlot('monthly', week, 9)).toBe('2026-08-03T09:00:00.000Z');
        expect(firstSlot('monthly', '2026-09-07', 9)).toBe('2026-09-07T09:00:00.000Z');
    });

    it('квартальная — первый день квартала', () => {
        expect(firstSlot('quarterly', week, 9)).toBe('2026-07-01T09:00:00.000Z');
        expect(firstSlot('quarterly', '2026-01-05', 9)).toBe('2026-01-01T09:00:00.000Z');
        expect(firstSlot('quarterly', '2026-11-30', 9)).toBe('2026-10-01T09:00:00.000Z');
    });
});

describe('повестка', () => {
    const weekly = RHYTHM.find((m) => m.code === 'weekly')!;
    const daily = RHYTHM.find((m) => m.code === 'daily')!;

    it('в недельную попадают числа программ', () => {
        const text = renderAgenda(weekly, ['Покраска: пропускная способность — не замерено']);
        expect(text).toContain('Покраска');
        expect(text).toContain('Программы и их числа');
    });

    it('без программ честно говорит, что их нет', () => {
        expect(renderAgenda(weekly, [])).toContain('программ пока нет');
    });

    it('в ежедневную числа не тащим — она про застрявшее', () => {
        const text = renderAgenda(daily, ['Покраска: пропускная способность']);
        expect(text).not.toContain('Покраска');
        expect(text).toContain('застряло');
    });
});

describe('наложение на занятость', () => {
    const busy = [
        { start: '2026-08-24T09:30:00Z', end: '2026-08-24T10:30:00Z' },
        { start: '2026-08-24T14:00:00Z', end: '2026-08-24T15:00:00Z' },
    ];

    it('пересечение находится', () => {
        expect(conflicts('2026-08-24T09:00:00Z', 60, busy)).toHaveLength(1);
        expect(conflicts('2026-08-24T10:00:00Z', 15, busy)).toHaveLength(1);
    });

    it('встык — не пересечение', () => {
        expect(conflicts('2026-08-24T08:30:00Z', 60, busy)).toEqual([]);
        expect(conflicts('2026-08-24T10:30:00Z', 60, busy)).toEqual([]);
    });

    it('свободное время чисто', () => {
        expect(conflicts('2026-08-24T12:00:00Z', 60, busy)).toEqual([]);
    });

    it('битые интервалы занятости пропускаются, а не роняют подбор', () => {
        expect(conflicts('2026-08-24T09:00:00Z', 60, [{ start: 'вчера', end: 'завтра' }])).toEqual([]);
    });
});
