/**
 * Кому всплывают оповещения.
 *
 * Правило: окошко дёргает того, кто ведёт заказ. У владельца номера менеджера
 * нет — он видел письма, задачи и звонки всего отдела и попросил убрать
 * (09.10.2026).
 */
import { describe, it, expect } from 'vitest';
import { alertAudience } from '@/lib/alerts/audience';

const session = (role: string, managerId: number | null) => ({
    user: {
        id: '1', email: null, username: null, first_name: null, last_name: null,
        avatar_url: null, role, retail_crm_manager_id: managerId, auth_source: 'legacy',
    },
    accessToken: null, refreshToken: null, expiresAt: null,
}) as any;

describe('адресат всплывающих оповещений', () => {
    it('менеджер получает — по своим заказам', () => {
        expect(alertAudience(session('manager', 119))).toEqual({ managerId: 119 });
    });

    it('владелец без номера менеджера не получает ничего', () => {
        expect(alertAudience(session('admin', null))).toBeNull();
    });

    it('просмотровая роль не получает ничего', () => {
        expect(alertAudience(session('logistics_view', null))).toBeNull();
    });

    it('нет сессии — нет оповещений', () => {
        expect(alertAudience(null)).toBeNull();
    });
});
