/**
 * Кто говорил в звонке.
 *
 * 12.10.2026 список звонков показывал «—» вместо менеджера на всех входящих:
 * брали первую ногу разговора, а там добавочный сценария (104), а не человека.
 */
import { describe, it, expect } from 'vitest';
import { callExtension, extensionFrom } from '@/lib/calls/extension';

describe('добавочный из записи звонка', () => {
    it('читает добавочный из «12037*119»', () => {
        expect(extensionFrom('12037*119')).toBe('119');
        expect(extensionFrom('12037*104@corp.telphin.ru')).toBe('104');
        expect(extensionFrom('+79269683868')).toBe('');
    });

    it('исходящий — тот, с чьего телефона звонили', () => {
        expect(callExtension({
            direction: 'outgoing',
            raw_payload: { from_username: '12037*119', to_username: '84956496960' },
        })).toBe('119');
    });

    it('входящий из очереди — тот, кто взял трубку, а не сценарий', () => {
        // Настоящая запись: девять ног, трубку взял 105, звонило ещё двоим.
        const call = {
            direction: 'incoming',
            raw_payload: {
                cdr: [
                    { flow: 'in', result: 'answered', duration: 0, extension_name: '12037*104@corp.telphin.ru', extension_type: 'phone' },
                    { flow: 'transfer', result: 'answered', duration: 121, extension_name: '12037*104@corp.telphin.ru', dest_number: '12037*105', extension_type: 'phone' },
                    { flow: 'transfer', result: 'answered elsewhere', duration: 0, dest_number: '12037*119', extension_type: 'phone' },
                    { flow: 'in', result: 'answered', duration: 121, extension_name: '12037*105@corp.telphin.ru', extension_type: 'phone' },
                ],
            },
        };
        expect(callExtension(call)).toBe('105');
    });

    it('никто не взял трубку — показываем, кому звонили', () => {
        expect(callExtension({
            direction: 'incoming',
            raw_payload: {
                cdr: [
                    { flow: 'in', result: 'no answer', duration: 0, extension_name: '12037*099@corp.telphin.ru', extension_type: 'ivr' },
                    { flow: 'transfer', result: 'no answer', duration: 0, dest_number: '12037*120', extension_type: 'phone' },
                ],
            },
        })).toBe('120');
    });

    it('звонок без разбора ног не ломает список', () => {
        expect(callExtension({ direction: 'incoming', raw_payload: {} })).toBe('');
        expect(callExtension({})).toBe('');
    });
});
