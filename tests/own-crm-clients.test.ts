/**
 * Клиент: реквизиты берём из карточки, а чего в ней нет — из последнего заказа
 * (в RetailCRM реквизиты привязаны к заказу, а не к покупателю). Связанные
 * карточки одного юрлица показываем, но не сливаем — решает человек.
 */
import { describe, it, expect, vi } from 'vitest';

const { db } = vi.hoisted(() => ({
    db: {
        clients: [
            { external_id: '100', inn: null, kpp: null, company_name: 'ООО Ромашка', orders_count: 3, total_summ: 500000 },
            { external_id: '200', inn: '7701234567', kpp: '770101001', company_name: 'ООО «Ромашка»', orders_count: 1, total_summ: 120000 },
        ],
        orders: [
            { number: '54872', contragent: { INN: '7701234567', KPP: '770101001', legalName: 'Общество с ограниченной ответственностью «Ромашка»', legalAddress: 'Москва, Тверская, 1' } },
        ],
        canon: [
            { cust_id: '100', group_key: 'inn:7701234567' },
            { cust_id: '200', group_key: 'inn:7701234567' },
        ],
    },
}));

vi.mock('@/utils/supabase', () => {
    const chain = (rows: any[]) => {
        const c: any = {
            eq: (col: string, val: any) => {
                if (col === 'cust_id') return chain(db.canon.filter((r) => r.cust_id === val));
                if (col === 'group_key') return chain(db.canon.filter((r) => r.group_key === val));
                if (col === 'external_id') return chain(db.clients.filter((r) => r.external_id === val));
                if (col === 'inn') return chain(db.clients.filter((r) => r.inn === val));
                return c;
            },
            in: (_col: string, vals: any[]) => chain(db.clients.filter((r) => vals.includes(r.external_id))),
            filter: () => c,
            not: () => c,
            order: () => c,
            limit: () => chain(rows),
            maybeSingle: async () => ({ data: rows[0] ?? null, error: null }),
            then: (res: any) => res({ data: rows, error: null }),
        };
        return c;
    };
    return {
        supabase: {
            from(table: string) {
                return {
                    select: () => chain(table === 'clients' ? db.clients : table === 'orders' ? db.orders : db.canon),
                };
            },
        },
    };
});

import { clientRequisites, relatedClients } from '@/lib/own-crm/clients';

describe('реквизиты клиента', () => {
    it('берёт недостающее из заказа и говорит, из какого', async () => {
        const r = await clientRequisites('100');
        expect(r.inn).toBe('7701234567');
        expect(r.legalAddress).toBe('Москва, Тверская, 1');
        expect(r.fromOrderNumber).toBe('54872');
    });

    it('карточка главнее заказа, если в ней ИНН есть', async () => {
        const r = await clientRequisites('200');
        expect(r.inn).toBe('7701234567');
        expect(r.kpp).toBe('770101001');
    });
});

describe('связанные карточки', () => {
    it('находит вторую карточку того же юрлица и объясняет причину', async () => {
        const list = await relatedClients('100');
        expect(list).toHaveLength(1);
        expect(list[0].customerId).toBe('200');
        expect(list[0].reason).toBe('канон');
        expect(list[0].name).toBe('ООО «Ромашка»');
    });

    it('сам себя в связанные не берёт', async () => {
        const list = await relatedClients('200');
        expect(list.map((x) => x.customerId)).not.toContain('200');
    });
});
