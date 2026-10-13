import { describe, expect, it } from 'vitest';
import { activeSince } from '@/lib/calls/active-call';

// Жалоба Евгении Матвеевой 13.10.2026: окна прошедших звонков висели сутками.
describe('граница «звонок идёт сейчас»', () => {
    const now = Date.parse('2026-10-13T10:00:00.000Z');

    it('гудок живёт две минуты', () => {
        expect(activeSince('ringing', now)).toBe('2026-10-13T09:58:00.000Z');
    });

    it('разговор — полчаса', () => {
        expect(activeSince('answered', now)).toBe('2026-10-13T09:30:00.000Z');
    });

    it('строка без статуса живёт как гудок', () => {
        expect(activeSince(null, now)).toBe('2026-10-13T09:58:00.000Z');
    });
});
