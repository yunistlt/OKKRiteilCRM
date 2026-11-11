/**
 * Сторожа над решением ИИ-РОПа.
 *
 * Решение дня отдано модели, поэтому проверяем не её вкус, а границы: работу
 * не из пула она взять не может, норму дня превысить не может, живую сделку
 * отложить не может, а недогруженный день код добирает сам. Всё, что сторожа
 * срезали, должно называться вслух — иначе решение непроверяемо.
 */
import { describe, it, expect } from 'vitest';
import { applyChiefDecision, parseChiefDecision, type ChiefLimits } from '@/lib/sales-rop/chief';
import { taskKey, type Task } from '@/lib/sales-rop/rules';

const task = (over: Partial<Task> = {}): Task => ({
    orderId: 100,
    number: '100',
    client: 'ООО «Ромашка»',
    statusCode: 'schet-na-oplate',
    statusName: 'Счёт на оплате',
    amount: 300_000,
    managerId: 10,
    reasonCode: 'invoice_stale',
    reasonText: 'счёт висит 5 дней',
    weight: 1,
    ...over,
});

const limits: ChiefLimits = { live: 3, longPlay: 2, minAlways: 1, maxPostponeDays: 120 };

const chose = (...keys: string[]) => ({
    tasks: keys.map((key) => ({ key, goal: 'выйти на просчёт', action: 'позвонить', ask: 'когда смотрят счёт' })),
    postpone: [],
    note: '',
});

describe('разбор решения РОПа', () => {
    it('читает план, отсрочки и записку', () => {
        const d = parseChiefDecision(
            JSON.stringify({
                'план': [{ 'ключ': 'order:1', 'цель': 'оплата', 'что_сделать': 'позвонить', 'о_чём_спросить': 'когда платят' }],
                'отложить': [{ 'ключ': 'order:2', 'дней': 30, 'почему': 'говорили вчера, нового нет' }],
                'записка': 'держи счёт на контроле',
            }),
        );
        expect(d?.tasks).toEqual([{ key: 'order:1', goal: 'оплата', action: 'позвонить', ask: 'когда платят' }]);
        expect(d?.postpone).toEqual([{ key: 'order:2', days: 30, why: 'говорили вчера, нового нет' }]);
        expect(d?.note).toBe('держи счёт на контроле');
    });

    it('поломанный ответ — не решение', () => {
        expect(parseChiefDecision('ну, я бы позвонил Ромашке')).toBeNull();
    });

    it('без действия и без ключа задание не задание', () => {
        const d = parseChiefDecision(
            JSON.stringify({ 'план': [{ 'ключ': 'order:1' }, { 'что_сделать': 'позвонить' }] }),
        );
        expect(d?.tasks).toEqual([]);
    });

    it('отсрочка без основания не применяется', () => {
        const d = parseChiefDecision(JSON.stringify({ 'отложить': [{ 'ключ': 'order:2', 'дней': 30 }] }));
        expect(d?.postpone).toEqual([]);
    });
});

describe('сторожа', () => {
    it('работу не из пула не берёт и говорит об этом', () => {
        const pool = [task({ orderId: 1, number: '1' })];
        const r = applyChiefDecision({ pool, decision: chose('order:1', 'order:999'), limits });
        expect(r.tasks.map(taskKey)).toEqual(['order:1']);
        expect(r.violations.join(' ')).toContain('order:999');
    });

    it('собственный звонок менеджера входит в день, даже если РОП о нём забыл', () => {
        const own = task({ orderId: 2, number: '2', reasonCode: 'contact_today', reasonText: 'контакт назначен на сегодня' });
        const pool = [own, task({ orderId: 1, number: '1' })];
        const r = applyChiefDecision({ pool, decision: chose('order:1'), limits });
        expect(r.tasks.map(taskKey)).toEqual(['order:2', 'order:1']);
    });

    it('норму дня превысить нельзя', () => {
        const pool = [1, 2, 3, 4, 5].map((i) => task({ orderId: i, number: String(i) }));
        const r = applyChiefDecision({ pool, decision: chose('order:1', 'order:2', 'order:3', 'order:4', 'order:5'), limits });
        expect(r.tasks).toHaveLength(3);
        expect(r.violations.join(' ')).toContain('норме дня');
    });

    it('работа вдолгую идёт после живых сделок и своей дозой', () => {
        const pool = [
            task({ orderId: 1, number: '1' }),
            ...[7, 8, 9].map((i) =>
                task({ orderId: i, number: String(i), reasonCode: 'development', reasonText: 'покупал, молчим 200 дн.' }),
            ),
        ];
        const r = applyChiefDecision({
            pool,
            decision: chose('order:7', 'order:8', 'order:9', 'order:1'),
            limits,
        });
        expect(r.tasks.map(taskKey)).toEqual(['order:1', 'order:7', 'order:8']);
        expect(r.violations.join(' ')).toContain('вдолгую');
    });

    it('пустой день не присылаем: добираем по правилам', () => {
        const pool = [1, 2].map((i) => task({ orderId: i, number: String(i) }));
        const r = applyChiefDecision({ pool, decision: { tasks: [], postpone: [], note: '' }, limits });
        expect(r.tasks).toHaveLength(1);
        expect(r.violations.join(' ')).toContain('добрал');
    });

    it('живую сделку отложить не даёт', () => {
        const pool = [task({ orderId: 1, number: '1' })];
        const r = applyChiefDecision({
            pool,
            decision: { ...chose('order:1'), postpone: [{ key: 'order:1', days: 30, why: 'клиент занят' }] },
            limits,
        });
        expect(r.postpone).toEqual([]);
        expect(r.violations.join(' ')).toContain('живую сделку');
    });

    it('отсрочку дальше предела не даёт', () => {
        const dev = task({ orderId: 7, number: '7', reasonCode: 'development', reasonText: 'покупал, молчим 200 дн.' });
        const r = applyChiefDecision({
            pool: [dev],
            decision: { ...chose('order:7'), postpone: [{ key: 'order:7', days: 400, why: 'сказал, что не нужно' }] },
            limits,
        });
        expect(r.postpone).toEqual([]);
        expect(r.violations.join(' ')).toContain('предел 120');
    });

    it('отсрочка работы вдолгую с основанием проходит', () => {
        const dev = task({ orderId: 7, number: '7', reasonCode: 'client_touch', reasonText: 'давно не общались' });
        const r = applyChiefDecision({
            pool: [dev],
            decision: { tasks: [], postpone: [{ key: 'order:7', days: 60, why: 'говорили в пятницу, нового нет' }], note: '' },
            limits,
        });
        expect(r.postpone).toEqual([{ task: dev, days: 60, why: 'говорили в пятницу, нового нет' }]);
    });

    it('задание по задаче доходит до плана', () => {
        const pool = [task({ orderId: 1, number: '1' })];
        const r = applyChiefDecision({ pool, decision: chose('order:1'), limits });
        expect(r.assignments.get('order:1')).toEqual({
            goal: 'выйти на просчёт',
            action: 'позвонить',
            ask: 'когда смотрят счёт',
        });
    });
});
