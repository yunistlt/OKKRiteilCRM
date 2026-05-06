/**
 * Тесты: PATCH /api/lead-catcher/invoices/[id] — смена статуса (оплата)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockUpdate, mockFrom } = vi.hoisted(() => {
    const mockUpdate = vi.fn();
    const mockFrom = vi.fn(() => ({
        update: mockUpdate,
        select: vi.fn(),
    }));
    return { mockUpdate, mockFrom };
});

vi.mock('@/utils/supabase', () => ({
    supabase: { from: mockFrom },
}));

vi.mock('@/lib/auth', () => ({
    getSession: vi.fn().mockResolvedValue({ user: { id: 'mgr-1' } }),
}));

import { PATCH } from '@/app/api/lead-catcher/invoices/[id]/route';

function makeRequest(body: Record<string, unknown>, id = 'inv-uuid-1') {
    const req = new Request(`http://localhost/api/lead-catcher/invoices/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    }) as any;
    return { req, params: { id } };
}

describe('PATCH /api/lead-catcher/invoices/[id]', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockUpdate.mockReturnValue({
            eq: vi.fn().mockReturnValue({
                select: vi.fn().mockReturnValue({
                    single: vi.fn().mockResolvedValue({
                        data: { id: 'inv-uuid-1', status: 'paid', paid_at: new Date().toISOString() },
                        error: null,
                    }),
                }),
            }),
        });
    });

    it('принимает статус paid и устанавливает paid_at', async () => {
        const { req, params } = makeRequest({ status: 'paid' });
        const resp = await PATCH(req, { params });
        expect(resp.status).toBe(200);
        const json = await resp.json();
        expect(json.success).toBe(true);
        // Проверяем что update был вызван с paid_at
        expect(mockUpdate).toHaveBeenCalledWith(
            expect.objectContaining({ status: 'paid', paid_at: expect.any(String) })
        );
    });

    it('принимает статус sent без paid_at', async () => {
        const { req, params } = makeRequest({ status: 'sent' });
        await PATCH(req, { params });
        const updateArg = mockUpdate.mock.calls[0][0];
        expect(updateArg.paid_at).toBeUndefined();
    });

    it('принимает статус cancelled', async () => {
        const { req, params } = makeRequest({ status: 'cancelled' });
        const resp = await PATCH(req, { params });
        expect(resp.status).toBe(200);
    });

    it('отклоняет недопустимый статус', async () => {
        const { req, params } = makeRequest({ status: 'unknown_status' });
        const resp = await PATCH(req, { params });
        expect(resp.status).toBe(400);
    });

    it('принимает manager_notes без статуса', async () => {
        const { req, params } = makeRequest({ manager_notes: 'Клиент перезвонил' });
        const resp = await PATCH(req, { params });
        expect(resp.status).toBe(200);
    });

    it('требует авторизации', async () => {
        const { getSession } = await import('@/lib/auth');
        vi.mocked(getSession).mockResolvedValueOnce(null as any);
        const { req, params } = makeRequest({ status: 'paid' });
        const resp = await PATCH(req, { params });
        expect(resp.status).toBe(401);
    });
});
