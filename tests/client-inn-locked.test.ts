/**
 * ИНН клиента, по которому прошли оплаты, менять нельзя.
 *
 * Решение владельца 14.10.2026. ИНН — это и есть клиент: по нему считаются его
 * покупки и признак «постоянный», от которого зависит ставка менеджера. Разбор
 * того же дня: карточка 2699 за годы сменила ИНН трижды, и заказы трёх разных
 * юрлиц считались покупками одного — у «Сталкера» выходило 5 покупок вместо
 * трёх оплаченных.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { db } = vi.hoisted(() => ({
    db: {
        clients: [] as any[],
        orders: [] as any[],
        order_payments: [] as any[],
    },
}));

vi.mock('@/utils/supabase', () => {
    const rowsOf = (table: string): any[] => (db as any)[table] ?? [];

    const make = (table: string) => {
        let picked: any[] = rowsOf(table);
        let patch: any = null;

        const api: any = {
            select: () => api,
            update: (values: any) => { patch = values; return api; },
            gt: (col: string, val: any) => { picked = picked.filter((r) => Number(r[col]) > Number(val)); return api; },
            in: (col: string, vals: any[]) => {
                picked = picked.filter((r) => vals.map(String).includes(String(r[col])));
                return api;
            },
            eq(col: string, val: any) {
                picked = picked.filter((r) => String(r[col]) === String(val));
                if (!patch) return api;
                for (const row of picked) Object.assign(row, patch);
                return Promise.resolve({ error: null });
            },
            maybeSingle: () => Promise.resolve({ data: picked[0] ?? null, error: null }),
            then: (resolve: any) => resolve({ data: picked, error: null }),
        };
        return api;
    };

    return { supabase: { from: (table: string) => make(table) } };
});

import { saveClientRequisites, InnLockedError } from '@/lib/own-crm/client-requisites';

beforeEach(() => {
    db.clients = [{ id: 2699, inn: '7327050877', company_name: 'ООО «Сталкер»' }];
    db.orders = [
        { id: 53666, number: '53666', customer_id: 2699 },
        { id: 34554, number: '34554', customer_id: 2699 },
    ];
    db.order_payments = [{ order_id: 53666, status: 'paid', amount: 115650 }];
});

describe('смена ИНН клиента', () => {
    it('не проходит, когда по клиенту есть оплаты, и называет заказы', async () => {
        await expect(saveClientRequisites(2699, { inn: '1655489507' }))
            .rejects.toBeInstanceOf(InnLockedError);

        try {
            await saveClientRequisites(2699, { inn: '1655489507' });
        } catch (e: any) {
            expect(e.paidOrders).toEqual(['53666']);
            expect(e.message).toContain('53666');
            // Неоплаченный заказ в объяснение не попадает: он ничего не держит.
            expect(e.message).not.toContain('34554');
        }

        expect(db.clients[0].inn).toBe('7327050877');
    });

    // Запрет только на ИНН: остальные реквизиты человек меняет свободно,
    // иначе из-за запертого ИНН не сохранить ни банк, ни адрес.
    it('сохраняет остальные реквизиты, даже когда ИНН заперт', async () => {
        await expect(saveClientRequisites(2699, { inn: '1655489507', bank: 'Точка', bankAccount: '40702810900000012345' }))
            .rejects.toBeInstanceOf(InnLockedError);

        expect(db.clients[0].inn).toBe('7327050877');
        expect(db.clients[0].bank).toBe('Точка');
        expect(db.clients[0].bankAccount).toBe('40702810900000012345');
    });

    it('пропускает тот же ИНН, записанный с пробелами', async () => {
        await expect(saveClientRequisites(2699, { inn: ' 7327 050 877 ' })).resolves.toBeUndefined();
    });

    it('пропускает заполнение пустого ИНН', async () => {
        db.clients = [{ id: 71837, inn: null }];
        db.orders = [{ id: 51445, number: '51445', customer_id: 71837 }];
        db.order_payments = [{ order_id: 51445, status: 'paid', amount: 1075400 }];

        await saveClientRequisites(71837, { inn: '3906405467' });
        expect(db.clients[0].inn).toBe('3906405467');
    });

    it('пропускает смену, пока оплат по клиенту не было', async () => {
        db.order_payments = [];
        await saveClientRequisites(2699, { inn: '1655489507' });
        expect(db.clients[0].inn).toBe('1655489507');
    });

    it('не трогает ИНН, когда его в запросе нет', async () => {
        await saveClientRequisites(2699, { bank: 'Точка' });
        expect(db.clients[0].inn).toBe('7327050877');
        expect(db.clients[0].bank).toBe('Точка');
    });
});
