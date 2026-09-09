import { beforeEach, describe, expect, it } from 'vitest';
import { checkDutyToken, dutyTokenConfigured } from '@/lib/shtab/duty-auth';
import { REPORT_KINDS, isKnownKind } from '@/lib/shtab/duty';
import { TASK_KINDS } from '@/lib/shtab/programs';

const TOKEN = 'служебный-токен-достаточной-длины-для-проверки';

beforeEach(() => {
    process.env.SHTAB_DUTY_TOKEN = TOKEN;
});

describe('токен служебного доступа', () => {
    it('свой токен принимается, в том числе с приставкой Bearer', () => {
        expect(checkDutyToken(`Bearer ${TOKEN}`)).toBe(true);
        expect(checkDutyToken(TOKEN)).toBe(true);
        expect(checkDutyToken(`  bearer   ${TOKEN}  `)).toBe(true);
    });

    it('чужой не принимается', () => {
        expect(checkDutyToken('Bearer чужой-токен-достаточной-длины-ааааа')).toBe(false);
        expect(checkDutyToken('Bearer ')).toBe(false);
        expect(checkDutyToken('')).toBe(false);
        expect(checkDutyToken(null)).toBe(false);
    });

    it('токен, отличающийся длиной, не роняет проверку', () => {
        // Наивное сравнение постоянного времени бросает исключение на строках
        // разной длины — и само становится утечкой: по ошибке видно длину.
        expect(() => checkDutyToken('Bearer к')).not.toThrow();
        expect(checkDutyToken('Bearer к')).toBe(false);
        expect(checkDutyToken(`Bearer ${TOKEN}${TOKEN}`)).toBe(false);
    });

    it('без токена в окружении не пускает никого', () => {
        delete process.env.SHTAB_DUTY_TOKEN;
        expect(dutyTokenConfigured()).toBe(false);
        expect(checkDutyToken(`Bearer ${TOKEN}`)).toBe(false);
        // Пустая строка в окружении не должна открывать доступ пустым заголовком.
        process.env.SHTAB_DUTY_TOKEN = '';
        expect(checkDutyToken('Bearer ')).toBe(false);
        expect(checkDutyToken('')).toBe(false);
    });

    it('короткий токен не считается настроенным', () => {
        process.env.SHTAB_DUTY_TOKEN = 'коротыш';
        expect(dutyTokenConfigured()).toBe(false);
        expect(checkDutyToken('Bearer коротыш')).toBe(false);
    });
});

describe('виды отчёта', () => {
    it('их ровно три и они осмысленны', () => {
        expect([...REPORT_KINDS]).toEqual(['done', 'stuck', 'note']);
    });

    it('типы задач известны слою', () => {
        for (const k of TASK_KINDS) expect(isKnownKind(k)).toBe(true);
        expect(isKnownKind('vydumannyy')).toBe(false);
    });
});
