/**
 * Слияние карточек одного юрлица.
 *
 * Главное, что проверяем: ИНН доезжает до главной карточки. Уникальный индекс
 * считает только неслитые карточки, поэтому дубль надо пометить ДО переноса —
 * иначе база отклоняет запись, и компания остаётся без ИНН (09.10.2026).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { db } = vi.hoisted(() => ({
    db: {
        clients: [] as any[],
        orders: [] as any[],
    },
}));

vi.mock('@/utils/supabase', () => {
    const rowsOf = (table: string) => (table === 'orders' ? db.orders : db.clients);

    const make = (table: string) => {
        let picked: any[] = rowsOf(table);
        let patch: any = null;

        const api: any = {
            select: () => api,
            update: (values: any) => { patch = values; return api; },
            is: (col: string, _v: null) => { picked = picked.filter((r) => !r[col]); return api; },
            not: () => api,
            in: (col: string, vals: any[]) => { picked = picked.filter((r) => vals.includes(String(r[col]))); return api; },
            filter: (expr: string, _op: string, val: any) => {
                if (expr === 'customer->>id') picked = picked.filter((r) => String(r.customer?.id) === String(val));
                return api;
            },
            eq(col: string, val: any) {
                const key = col === 'id' ? 'id' : col;
                picked = picked.filter((r) => String(r[key]) === String(val));

                if (!patch) return api;

                // Подобие уникального индекса `clients_inn_unique`: ИНН не
                // может повторяться среди НЕслитых карточек.
                if (table === 'clients' && patch.inn) {
                    const clash = db.clients.some((r) => r.inn === patch.inn && !r.merged_into && !picked.includes(r));
                    if (clash) return Promise.resolve({ error: { code: '23505', message: 'clients_inn_unique' } });
                }
                for (const row of picked) Object.assign(row, patch);
                return Promise.resolve({ error: null });
            },
            maybeSingle: async () => ({ data: picked[0] ?? null, error: null }),
            then: (res: any) => res({ data: picked, error: null, count: picked.length }),
        };
        return api;
    };

    return { supabase: { from: (table: string) => make(table) } };
});

import { mergeClients } from '@/lib/own-crm/merge-clients';

beforeEach(() => {
    db.clients = [
        { id: 66493, company_name: 'ООО ТД «Пищевые технологии»', inn: null, bank: 'Сбербанк', merged_into: null, phones: [] },
        { id: 12722, company_name: 'ООО «Торговый дом Пищевые технологии»', inn: '2309081489', bank: null, merged_into: null, phones: [] },
    ];
    db.orders = [
        { id: 1, customer: { id: 12722 }, raw_payload: { customer: { id: 12722 } } },
    ];
});

describe('слияние карточек', () => {
    it('переносит ИНН в главную карточку и помечает дубль', async () => {
        const result = await mergeClients(66493, 12722, 'тест');

        const main = db.clients.find((c) => c.id === 66493);
        const dup = db.clients.find((c) => c.id === 12722);

        expect(main.inn).toBe('2309081489');
        expect(dup.merged_into).toBe(66493);
        expect(dup.inn).toBeNull();
        expect(result.movedOrders).toBe(1);
        expect(db.orders[0].customer.id).toBe(66493);
        expect(db.orders[0].raw_payload.customer.id).toBe(66493);
    });

    it('не сливает карточку саму с собой', async () => {
        await expect(mergeClients(66493, 66493)).rejects.toThrow('одна и та же');
    });

    it('не трогает уже слитую карточку', async () => {
        db.clients[1].merged_into = 66493;
        await expect(mergeClients(66493, 12722)).rejects.toThrow('уже слита');
    });
});
