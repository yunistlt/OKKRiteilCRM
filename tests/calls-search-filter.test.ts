/**
 * Поиск в разделе «Звонки» ищет тем, чем звонок помечен: телефоном клиента,
 * добавочным менеджера, заказом. Жалоба владельца 15.10.2026 — «не работает
 * фильтр ни по менеджерам, ни по фамилии клиентов».
 */
import { describe, it, expect, vi } from 'vitest';

const { db } = vi.hoisted(() => ({
    db: {
        managers: [{ telphin_extension: '119' }] as any[],
        clients: [{ id: 31182, phones: ['+79137136987'] }] as any[],
        customers: [] as any[],
        client_contacts: [] as any[],
        orders: [{ id: 900000072, number: '900072' }] as any[],
        call_order_matches: [{ telphin_call_id: 'CALL-1' }] as any[],
        retailcrm_calls: [{ external_id: 'UUID-1' }] as any[],
        raw_telphin_calls: [{ telphin_call_id: 'CALL-2' }] as any[],
    },
}));

vi.mock('@/utils/supabase', () => {
    const chain = (rows: any[]) => {
        const c: any = new Proxy(
            {
                then: (res: any) => res({ data: rows, error: null }),
            },
            {
                get(target: any, prop: string) {
                    if (prop === 'then') return target.then;
                    return () => c;
                },
            },
        );
        return c;
    };
    return {
        supabase: {
            from: (table: string) => ({ select: () => chain((db as any)[table] ?? []) }),
        },
    };
});

import { buildCallSearchFilter } from '@/lib/calls/search-filter';

describe('фильтр звонков', () => {
    it('ищет по менеджеру — добавочным из его карточки', async () => {
        const parts = await buildCallSearchFilter('Матвеева');
        expect(parts).toContain('manager_extension.in.(119)');
    });

    it('ищет по клиенту — телефоном в том же виде, что у звонка (последние 10 цифр)', async () => {
        const parts = await buildCallSearchFilter('Мордовская');
        expect(parts).toContain('from_number_normalized.in.(9137136987)');
        expect(parts).toContain('to_number_normalized.in.(9137136987)');
    });

    it('ищет по номеру заказа — через привязку звонка', async () => {
        const parts = await buildCallSearchFilter('900072');
        const byId = parts.find((p) => p.startsWith('telphin_call_id.in.'));
        expect(byId).toBeTruthy();
        expect(byId).toContain('CALL-1');
        // Записи RetailCRM переведены в звонки, а не подставлены списком в скобках.
        expect(parts.join(',')).not.toContain('{');
    });

    it('запятая и скобки в названии не рвут фильтр', async () => {
        const parts = await buildCallSearchFilter('ООО «СКС», Иркутск');
        expect(parts[0]).toBe('from_number.ilike."%ООО «СКС», Иркутск%"');
    });

    it('пустой запрос фильтра не даёт', async () => {
        expect(await buildCallSearchFilter('   ')).toEqual([]);
    });
});
