/**
 * Тесты критических путей: создание КП (API /api/lead-catcher/proposals)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Моки ─────────────────────────────────────────────────────────────────────

const { mockInsert, mockStorageUpload, mockStorageGetPublicUrl, mockFrom } = vi.hoisted(() => {
    const mockInsert = vi.fn();
    const mockStorageUpload = vi.fn().mockResolvedValue({ data: {}, error: null });
    const mockStorageGetPublicUrl = vi.fn().mockReturnValue({
        data: { publicUrl: 'https://storage.example.com/proposals/token123.pdf' },
    });
    const mockFrom = vi.fn(() => ({
        insert: mockInsert,
        select: vi.fn(),
        update: vi.fn(() => ({ eq: vi.fn(() => Promise.resolve({ error: null })) })),
    }));
    return { mockInsert, mockStorageUpload, mockStorageGetPublicUrl, mockFrom };
});

vi.mock('@/utils/supabase', () => ({
    supabase: {
        from: mockFrom,
        storage: {
            from: vi.fn(() => ({
                upload: mockStorageUpload,
                getPublicUrl: mockStorageGetPublicUrl,
            })),
        },
    },
}));

vi.mock('@/lib/pdf-generator', () => ({
    generateProposalPDF: vi.fn().mockResolvedValue(Buffer.from('PDF')),
    generateInvoicePDF: vi.fn().mockResolvedValue(Buffer.from('PDF')),
}));

vi.mock('@/utils/openai', () => ({
    getOpenAIClient: vi.fn(() => ({
        chat: {
            completions: {
                create: vi.fn().mockResolvedValue({
                    choices: [{ message: { content: 'Тестовое КП' } }],
                }),
            },
        },
    })),
}));

vi.mock('@/lib/auth', () => ({
    getSession: vi.fn().mockResolvedValue({ user: { id: 'mgr-1' } }),
}));

vi.mock('@/lib/error-monitor', () => ({
    logError: vi.fn(),
    logWarn: vi.fn(),
    logInfo: vi.fn(),
}));

import { POST, GET } from '@/app/api/lead-catcher/proposals/route';

function makeRequest(body: Record<string, unknown>, method = 'POST') {
    return new Request('http://localhost/api/lead-catcher/proposals', {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    }) as any;
}

function makeGetRequest(sessionId: string) {
    return new Request(`http://localhost/api/lead-catcher/proposals?session_id=${sessionId}`) as any;
}

describe('GET /api/lead-catcher/proposals', () => {
    it('требует session_id', async () => {
        const req = new Request('http://localhost/api/lead-catcher/proposals') as any;
        const resp = await GET(req);
        expect(resp.status).toBe(400);
    });

    it('возвращает список при наличии session_id', async () => {
        mockFrom.mockReturnValue({
            select: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                    order: vi.fn().mockResolvedValue({ data: [], error: null }),
                }),
            }),
        });
        const resp = await GET(makeGetRequest('sess-123'));
        expect(resp.status).toBe(200);
        const json = await resp.json();
        expect(json.proposals).toEqual([]);
    });
});

describe('POST /api/lead-catcher/proposals — валидация', () => {
    beforeEach(() => { vi.clearAllMocks(); });

    it('отклоняет запрос без session_id', async () => {
        const resp = await POST(makeRequest({
            title: 'Тест',
            items: [{ name: 'Товар', quantity: 1, price: 1000 }],
        }));
        expect(resp.status).toBe(400);
    });

    it('отклоняет запрос без items', async () => {
        const resp = await POST(makeRequest({
            session_id: 'sess-1',
            title: 'КП',
            items: [],
        }));
        expect(resp.status).toBe(400);
    });

    it('отклоняет items без обязательных полей', async () => {
        const resp = await POST(makeRequest({
            session_id: 'sess-1',
            title: 'КП',
            items: [{ quantity: 1 }], // нет name и price
        }));
        expect(resp.status).toBe(400);
    });
});
