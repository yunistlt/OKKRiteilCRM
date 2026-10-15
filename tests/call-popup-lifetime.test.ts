/**
 * Окно звонка живёт столько, сколько идёт разговор.
 *
 * Проверяем на ЖИВЫХ событиях Телфина из журнала `telphin_webhook_log` за
 * 15.10.2026 — на них и сломалось (жалоба владельца: «время отображения попапа
 * звонка надо на время длительности звонка»).
 */
import { describe, expect, it } from 'vitest';
import { callAfterLegEnded, callStillFresh } from '@/lib/calls/active-call';

type Event = { type: 'dial' | 'hangup'; leg: string; talked?: boolean };

/** Проигрываем события звонка и возвращаем, на каком из них окно погасло. */
function playback(events: Event[]): number {
    let legs: string[] = [];
    for (let index = 0; index < events.length; index += 1) {
        const event = events[index];
        if (event.type === 'dial') {
            if (!legs.includes(event.leg)) legs = [...legs, event.leg];
            continue;
        }
        const { done, left } = callAfterLegEnded(legs, event.leg, Boolean(event.talked));
        if (done) return index;
        legs = left;
    }
    return -1;
}

describe('окно звонка гаснет вместе со звонком', () => {
    /**
     * Входящий 15.10.2026, CallID 5d806483…: разговор 17,6 с, четыре ноги.
     * Раньше окно убивал четвёртый по счёту `hangup` ноги 669428-1
     * (CHANUNAVAIL, 0 с) — добавочный 103 просто не снял трубку.
     */
    const вхоящий: Event[] = [
        { type: 'dial', leg: '94407-5d' },
        { type: 'dial', leg: '669428-1' },
        { type: 'dial', leg: '669428-c' },
        { type: 'hangup', leg: '669428-1', talked: false },
        { type: 'dial', leg: '669428-4' },
        { type: 'hangup', leg: '669428-4', talked: false },
        { type: 'hangup', leg: '669428-c', talked: false },
        { type: 'hangup', leg: '94407-5d', talked: true },
    ];

    it('не гаснет на отбое ноги, которая не взяла трубку', () => {
        expect(playback(вхоящий)).toBe(вхоящий.length - 1);
    });

    /**
     * Исходящий 15.10.2026, CallID 39a8d286…: шесть ног очереди, все отбились
     * нулевой длительностью — разговора не было, окно обязано погаснуть на
     * последней.
     */
    it('гаснет, когда закрылась последняя нога', () => {
        const очередь: Event[] = [
            { type: 'dial', leg: '381722-4' },
            { type: 'dial', leg: '373544-4' },
            { type: 'dial', leg: '349957-a' },
            { type: 'dial', leg: '349963-6' },
            { type: 'hangup', leg: '349963-6', talked: false },
            { type: 'hangup', leg: '349957-a', talked: false },
            { type: 'hangup', leg: '373544-4', talked: false },
            { type: 'hangup', leg: '381722-4', talked: false },
        ];
        expect(playback(очередь)).toBe(очередь.length - 1);
    });

    it('отбой разговаривавшей ноги гасит окно сразу', () => {
        expect(callAfterLegEnded(['a', 'b'], 'a', true)).toEqual({ done: true, left: [] });
    });

    it('без номера ноги ведём себя как раньше — гасим', () => {
        expect(callAfterLegEnded([], null, false).done).toBe(true);
    });
});

describe('строка живёт, пока открыта хоть одна нога', () => {
    const начало = new Date('2026-10-15T11:00:00.000Z').toISOString();
    const через10минут = new Date('2026-10-15T11:10:00.000Z').getTime();

    it('гудок без ног протухает за две минуты', () => {
        expect(callStillFresh({ status: 'ringing', started_at: начало, legs: [] }, через10минут)).toBe(false);
    });

    it('звонок с открытой ногой живёт как разговор', () => {
        // Телфин на входящем может не прислать «answer» вовсе — статус так и
        // останется «гудок», а разговор при этом идёт.
        expect(callStillFresh({ status: 'ringing', started_at: начало, legs: ['94407-5d'] }, через10минут)).toBe(true);
    });
});
