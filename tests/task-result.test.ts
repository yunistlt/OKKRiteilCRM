import { describe, expect, it } from 'vitest';
import { collapseCalls, levelOf } from '@/lib/sales-rop/task-result';
import { recommend, type ManagerWeek } from '@/lib/sales-rop/load-review';

/**
 * Методика разбора: чем задача кончилась и можно ли человеку дать больше работы.
 *
 * Проверяется здесь, потому что по этим цифрам принимают решения о людях. Один
 * неверный статус — и менеджер, закрывавший заказы записями в карточке,
 * получает прибавку к нагрузке как лучший.
 */

const base = {
    plan_date: '2026-09-22',
    order_id: 1,
    manager_id: 249,
    reason_code: 'invoice_stale',
    amount: 100_000,
    touched: false,
    touch_kind: null as string | null,
    calls_count: 0,
    call_seconds: 0,
    call_first_at: null as string | null,
    emails_count: 0,
    call_source: null as string | null,
    client_replied: false,
    client_reply_at: null as string | null,
    movement_type: null as string | null,
    movement_at: null as string | null,
    money_type: null as string | null,
    money_amount: null as number | null,
    money_at: null as string | null,
    details: {},
};

describe('чем кончилась задача', () => {
    it('не тронули — нулевая ступень', () => {
        expect(levelOf(base)).toEqual({ level: 0, status: 'not_touched' });
    });

    // Главное различение всей методики: запись о работе не равна работе.
    it('один комментарий — это не контакт', () => {
        const r = levelOf({ ...base, touched: true, touch_kind: 'комментарий' });
        expect(r).toEqual({ level: 1, status: 'comment_only' });
    });

    it('звонок поднимает до подтверждённого контакта', () => {
        const r = levelOf({ ...base, touched: true, touch_kind: 'звонок', calls_count: 1 });
        expect(r.level).toBe(2);
    });

    it('ответ клиента выше нашего звонка', () => {
        const r = levelOf({ ...base, touched: true, calls_count: 1, client_replied: true });
        expect(r).toEqual({ level: 3, status: 'client_replied' });
    });

    it('движение заказа выше ответа', () => {
        const r = levelOf({ ...base, touched: true, calls_count: 1, client_replied: true, movement_type: 'status_changed' });
        expect(r.level).toBe(4);
    });

    it('деньги — верхняя ступень', () => {
        const r = levelOf({ ...base, touched: true, movement_type: 'sent_to_production', money_type: 'sent_to_production' });
        expect(r).toEqual({ level: 5, status: 'money_result' });
    });

    // Закрыть заказ молча — не результат, а потерянный клиент, о котором мы не
    // знаем, почему он ушёл. Такая «работа» не должна выглядеть как движение.
    it('отмена без разговора не считается движением', () => {
        const r = levelOf({ ...base, touched: true, touch_kind: 'смена статуса', movement_type: 'lost' });
        expect(r).toEqual({ level: 1, status: 'closed_lost_unconfirmed' });
    });

    it('отмена после разговора — нормальное движение', () => {
        const r = levelOf({ ...base, touched: true, calls_count: 1, movement_type: 'lost' });
        expect(r.level).toBe(4);
    });
});

describe('схлопывание попыток дозвона', () => {
    const call = (min: number, sec: number) => ({
        started_at: `2026-09-22T10:${String(min).padStart(2, '0')}:00.000Z`,
        duration_sec: sec,
        from_number: '7900',
        to_number: '7901',
    });

    // Очередь звонит нескольким сразу: без схлопывания один разговор выглядит
    // как три, и активность отдела завышается втрое.
    it('попытки в пределах двух минут — один разговор', () => {
        const out = collapseCalls([call(10, 0), call(10, 0), call(11, 45)]);
        expect(out).toHaveLength(1);
        expect(out[0].duration_sec).toBe(45);
    });

    it('разговоры врозь остаются разными', () => {
        const out = collapseCalls([call(10, 30), call(20, 60)]);
        expect(out).toHaveLength(2);
    });
});

const week = (over: Partial<ManagerWeek> = {}): ManagerWeek => ({
    managerId: 249,
    name: 'Гордеева Ирина',
    workDays: 5,
    tasksIssued: 50,
    tasksTouched: 49,
    tasksCommentOnly: 2,
    tasksConfirmed: 30,
    tasksReplied: 10,
    tasksMoved: 8,
    tasksMoney: 2,
    tasksClosedUnconfirmed: 0,
    calls: 80,
    callMinutes: 200,
    emails: 5,
    productionCount: 2,
    productionAmount: 500_000,
    touchedRate: 0.98,
    commentOnlyRate: 0.04,
    confirmedRate: 0.6,
    movementRate: 0.16,
    personalFactor: null,
    absent: false,
    ...over,
});

describe('рекомендация по нагрузке', () => {
    it('хорошая работа — можно поднять', () => {
        const r = recommend(week());
        expect(r.action).toBe('increase');
        expect(r.suggestedFactor).toBe(1.1);
    });

    // Качество раньше количества: отработка 100% из одних комментариев — это не
    // работа, а способ закрыть список.
    it('много комментариев без контакта — сначала качество', () => {
        const r = recommend(week({ tasksCommentOnly: 20, commentOnlyRate: 0.4 }));
        expect(r.action).toBe('check_quality_first');
        expect(r.suggestedFactor).toBeNull();
    });

    it('низкая отработка — снизить', () => {
        const r = recommend(week({ touchedRate: 0.5, personalFactor: 1.2 }));
        expect(r.action).toBe('decrease');
        expect(r.suggestedFactor).toBe(1.1);
    });

    // Вопрос к алгоритму, а не к человеку.
    it('мало задач при хорошей отработке — недобор задач', () => {
        const r = recommend(week({ tasksIssued: 15, workDays: 5, touchedRate: 0.95, confirmedRate: 0.2, movementRate: 0 }));
        expect(r.action).toBe('check_task_shortage');
    });

    it('отсутствовал — вывода нет', () => {
        expect(recommend(week({ absent: true })).action).toBe('hold_until_more_data');
    });

    it('мало дней — вывода нет', () => {
        expect(recommend(week({ workDays: 2 })).action).toBe('hold_until_more_data');
    });

    // Верхняя граница та же, что у ручной настройки: удвоенная норма это
    // предел, за которым список перестают делать вовсе.
    it('выше двух не предлагает', () => {
        const r = recommend(week({ personalFactor: 2 }));
        expect(r.suggestedFactor).toBeNull();
    });
});
