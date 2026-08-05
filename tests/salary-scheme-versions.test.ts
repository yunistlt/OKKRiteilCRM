/**
 * Версионирование схем мотивации: сохранение с новой датой создаёт НОВУЮ версию,
 * прежняя остаётся. До этого исправления смена даты удаляла исходную версию —
 * роль с 01.02.2026, переведённая на 01.08.2026, оставляла февраль–июль вообще
 * без схемы, и ведомость за июль обнулялась.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockFrom, calls } = vi.hoisted(() => {
    const calls: { table: string; op: string; arg?: any }[] = [];

    const makeBuilder = (table: string) => {
        const builder: any = {
            upsert(row: any) {
                calls.push({ table, op: 'upsert', arg: row });
                return {
                    select: () => ({ single: async () => ({ data: { id: 777 }, error: null }) }),
                };
            },
            insert(rows: any) {
                calls.push({ table, op: 'insert', arg: rows });
                return Promise.resolve({ error: null });
            },
            delete() {
                calls.push({ table, op: 'delete' });
                const chain: any = {
                    eq: () => chain,
                    is: () => chain,
                    then: (res: any) => res({ data: [], error: null }),
                };
                return chain;
            },
            select() {
                const chain: any = {
                    eq: () => chain,
                    is: () => chain,
                    order: () => chain,
                    then: (res: any) => res({ data: [], error: null }),
                };
                return chain;
            },
        };
        return builder;
    };

    const mockFrom = vi.fn((table: string) => makeBuilder(table));
    return { mockFrom, calls };
});

vi.mock('@/utils/supabase', () => ({ supabase: { from: mockFrom } }));

import { saveScheme } from '@/lib/salary/schemes';

describe('saveScheme — версии роли', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        calls.length = 0;
    });

    it('смена даты НЕ удаляет прежнюю версию роли', async () => {
        await saveScheme({
            code: 'menedzhery',
            name: 'Менеджеры ОП',
            effectiveFrom: '2026-08-01',
            prevEffectiveFrom: '2026-02-01', // открыта была февральская версия
            blocks: [{ block_code: 'oklad', params: { oklad: 30000 } }],
            actor: 'test',
        });

        // Единственное удаление, которое допустимо, — очистка блоков ТЕКУЩЕЙ
        // сохраняемой версии перед вставкой новых. Строки salary_scheme не трогаем.
        const schemeDeletes = calls.filter((c) => c.table === 'salary_scheme' && c.op === 'delete');
        expect(schemeDeletes).toHaveLength(0);
    });

    it('новая версия пишется на указанную дату', async () => {
        await saveScheme({
            code: 'menedzhery',
            name: 'Менеджеры ОП',
            effectiveFrom: '2026-08-01',
            prevEffectiveFrom: '2026-02-01',
            blocks: [],
            actor: 'test',
        });

        const upsert = calls.find((c) => c.table === 'salary_scheme' && c.op === 'upsert');
        expect(upsert?.arg).toMatchObject({ code: 'menedzhery', effective_from: '2026-08-01' });
    });

    it('в аудит-лог попадает, какая версия правилась и какая получилась', async () => {
        await saveScheme({
            code: 'menedzhery',
            name: 'Менеджеры ОП',
            effectiveFrom: '2026-08-01',
            prevEffectiveFrom: '2026-02-01',
            blocks: [],
            actor: 'test',
        });

        const audit = calls.find((c) => c.table === 'salary_audit_log' && c.op === 'insert');
        expect(audit?.arg).toMatchObject({
            entity: 'scheme',
            entity_id: 'menedzhery',
            old_value: { effectiveFrom: '2026-02-01' },
            new_value: { effectiveFrom: '2026-08-01' },
        });
    });

    it('правка без смены даты остаётся правкой той же версии', async () => {
        await saveScheme({
            code: 'menedzhery',
            name: 'Менеджеры ОП',
            effectiveFrom: '2026-02-01',
            prevEffectiveFrom: '2026-02-01',
            blocks: [{ block_code: 'oklad', params: { oklad: 31000 } }],
            actor: 'test',
        });

        const upsert = calls.find((c) => c.table === 'salary_scheme' && c.op === 'upsert');
        expect(upsert?.arg).toMatchObject({ effective_from: '2026-02-01' });
        expect(calls.filter((c) => c.table === 'salary_scheme' && c.op === 'delete')).toHaveLength(0);
    });
});
