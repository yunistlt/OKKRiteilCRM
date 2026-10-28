import { describe, expect, it } from 'vitest';
import { compareActions } from '@/lib/analytics/my-day';
import type { NextAction } from '@/lib/analytics/my-day';

// Порядок очереди на экране «Мой день» (решение владельца 28.10.2026):
// сначала заявки в рабочих статусах, потом поступившие сегодня, потом
// развитие клиента. До этого всё стояло одной очередью по весу, и экран
// предлагал «напомнить о себе» раньше, чем дожать счёт на оплате.

const action = (over: Partial<NextAction>): NextAction => ({
    orderId: 1,
    orderNumber: '54132',
    client: 'ООО «Техномакс»',
    amount: 100_000,
    statusName: 'Отложено',
    action: 'Связаться',
    reason: 'повод',
    advice: null,
    kind: 'plan',
    block: 'active',
    weight: 100,
    slaLeftMinutes: null,
    done: false,
    ...over,
});

const order = (list: NextAction[]) => [...list].sort(compareActions).map((a) => a.kind);

describe('очередь «Мой день»', () => {
    it('заявки в работе идут раньше поступивших сегодня', () => {
        // У нового лида вес выше по построению (горящий SLA), но разбирать
        // день менеджер начинает с того, что уже в работе.
        const list = [action({ kind: 'lead', weight: 300 }), action({ kind: 'plan', weight: 50 })];
        expect(order(list)).toEqual(['plan', 'lead']);
    });

    it('развитие клиента — последним, каким бы крупным ни был клиент', () => {
        const list = [
            action({ kind: 'development', block: 'development', weight: 900 }),
            action({ kind: 'lead', weight: 200 }),
            action({ kind: 'stale', weight: 10 }),
        ];
        expect(order(list)).toEqual(['stale', 'lead', 'development']);
    });

    it('внутри яруса порядок по весу', () => {
        const list = [action({ kind: 'plan', weight: 10 }), action({ kind: 'promise', weight: 90 })];
        expect(order(list)).toEqual(['promise', 'plan']);
    });

    it('отработанное уходит вниз, даже если это активная заявка', () => {
        const list = [
            action({ kind: 'plan', weight: 900, done: true }),
            action({ kind: 'development', block: 'development', weight: 1 }),
        ];
        expect(order(list)).toEqual(['development', 'plan']);
    });
});
