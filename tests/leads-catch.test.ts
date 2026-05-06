/**
 * Тесты критических путей: захват лида (API /api/leads/catch)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Моки до импорта роута ────────────────────────────────────────────────────

const { mockInsert, mockFrom } = vi.hoisted(() => {
    const mockInsert = vi.fn();
    const mockFrom = vi.fn(() => ({
        insert: mockInsert,
        select: vi.fn(),
        update: vi.fn(() => ({ eq: vi.fn(() => ({ eq: vi.fn() })) })),
        eq: vi.fn(() => ({ maybeSingle: vi.fn(() => ({ data: null, error: null })) })),
    }));
    return { mockInsert, mockFrom };
});

vi.mock('@/utils/supabase', () => ({
    supabase: { from: mockFrom },
}));

vi.mock('@/lib/retailcrm-leads', () => ({
    createLeadInCrm: vi.fn().mockResolvedValue({ id: 999 }),
}));

vi.mock('@/lib/error-monitor', () => ({
    logError: vi.fn(),
    logWarn: vi.fn(),
    logInfo: vi.fn(),
}));

vi.mock('@/lib/rate-limit', () => ({
    checkRateLimit: vi.fn().mockReturnValue(null),
    getClientIp: vi.fn().mockReturnValue('127.0.0.1'),
    getRateLimiter: vi.fn(),
}));

import { POST } from '@/app/api/leads/catch/route';

// ── Хелпер ───────────────────────────────────────────────────────────────────
function makeRequest(body: Record<string, unknown>) {
    return new Request('http://localhost/api/leads/catch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });
}

// ── Тесты ────────────────────────────────────────────────────────────────────

describe('POST /api/leads/catch — Шаг 1 (email)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        // Успешный INSERT: возвращает id
        mockInsert.mockReturnValue({
            select: vi.fn().mockReturnValue({
                single: vi.fn().mockResolvedValue({ data: { id: 'test-uuid-1' }, error: null }),
            }),
        });
    });

    it('принимает валидный email и возвращает lead_id', async () => {
        const resp = await POST(makeRequest({ email: 'user@example.com', price: 50000 }));
        const json = await resp.json();
        expect(resp.status).toBe(200);
        expect(json.success).toBe(true);
        expect(json.lead_id).toBe('test-uuid-1');
    });

    it('отклоняет пустой email', async () => {
        const resp = await POST(makeRequest({ email: '' }));
        const json = await resp.json();
        expect(resp.status).toBe(400);
        expect(json.success).toBe(false);
    });

    it('отклоняет email без @', async () => {
        const resp = await POST(makeRequest({ email: 'notanemail' }));
        expect(resp.status).toBe(400);
    });

    it('пропускает honeypot — возвращает fake success', async () => {
        const resp = await POST(makeRequest({ email: 'bot@evil.com', _hp: 'filled' }));
        const json = await resp.json();
        expect(resp.status).toBe(200);
        expect(json.lead_id).toBe('hp');
    });
});

describe('POST /api/leads/catch — Шаг 2 (phone)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        // select → существующий лид
        mockFrom.mockReturnValue({
            insert: vi.fn(),
            select: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                    single: vi.fn().mockResolvedValue({
                        data: { id: 'test-uuid-2', email: 'u@u.com', specs: {}, price: 30000 },
                        error: null,
                    }),
                }),
            }),
            update: vi.fn().mockReturnValue({
                eq: vi.fn().mockResolvedValue({ error: null }),
            }),
        });
    });

    it('отклоняет короткий номер телефона', async () => {
        const resp = await POST(makeRequest({ lead_id: 'test-uuid-2', phone: '123' }));
        const json = await resp.json();
        expect(resp.status).toBe(400);
        expect(json.success).toBe(false);
    });
});
