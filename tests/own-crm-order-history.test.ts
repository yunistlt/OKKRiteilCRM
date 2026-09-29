/**
 * Лента событий заказа: человек и модель должны видеть «Дата следующего
 * контакта: 29.09 → 22.10», а не `custom_data_kontakta` и коды статусов.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { rows } = vi.hoisted(() => ({
    rows: {
        fields: [{ code: 'data_kontakta', name: 'Дата следующего контакта', type: 'date', dictionary: null },
                 { code: 'prichiny_otmeny', name: 'Причины Отмены', type: 'dictionary', dictionary: 'prichiny_otmeny_zakazov' }],
        dictionaries: [{ dictionary_code: 'prichiny_otmeny_zakazov', item_code: 'calc_rate', item_name: 'Смета' }],
        entities: [{ entity_type: 'status', item_code: 'novyi-1', item_name: 'Новый' },
                   { entity_type: 'status', item_code: 'soglasovanie-otmeny', item_name: 'Согласование отмены' }],
        history: [
            { field: 'status', old_value: '{"code":"novyi-1"}', new_value: '{"code":"soglasovanie-otmeny"}', user_data: { id: 249 }, occurred_at: '2026-09-29T10:00:00Z' },
            { field: 'custom_prichiny_otmeny', old_value: null, new_value: 'calc_rate', user_data: { id: 249 }, occurred_at: '2026-09-29T10:01:00Z' },
            { field: 'manager_comment', old_value: 'было', new_value: 'стало', user_data: null, occurred_at: '2026-09-29T10:02:00Z' },
        ],
        managers: [{ id: 249, first_name: 'Иван', last_name: 'Петров' }],
    },
}));

vi.mock('@/utils/supabase', () => {
    const chain = (data: any[]) => {
        const c: any = {
            eq: () => c, not: () => c, is: () => c, in: () => c, order: () => c, limit: () => c,
            then: (res: any) => res({ data, error: null }),
        };
        return c;
    };
    return {
        supabase: {
            from(table: string) {
                return {
                    select: (cols: string) => {
                        if (table === 'retailcrm_custom_fields') return chain(rows.fields);
                        if (table === 'retailcrm_dictionaries') return chain(cols.includes('entity_type') ? rows.entities : rows.dictionaries);
                        if (table === 'order_history_log') return chain(rows.history);
                        if (table === 'managers') return chain(rows.managers);
                        return chain([]);
                    },
                };
            },
        },
    };
});

import { orderEvents, eventsToText } from '@/lib/own-crm/history';
import { resetFieldNamesCache } from '@/lib/own-crm/field-names';

beforeEach(() => resetFieldNamesCache());

describe('лента событий заказа', () => {
    it('статус показывает названием, а не кодом', async () => {
        const [status] = await orderEvents(1);
        expect(status.label).toBe('Статус');
        expect(status.from).toBe('Новый');
        expect(status.to).toBe('Согласование отмены');
    });

    it('своё поле показывает названием, значение — из справочника', async () => {
        const [, reason] = await orderEvents(1);
        expect(reason.label).toBe('Причины Отмены');
        expect(reason.to).toBe('Смета');
        expect(reason.from).toBeNull();
    });

    it('подставляет фамилию сотрудника вместо его номера', async () => {
        const [status] = await orderEvents(1);
        expect(status.who).toBe('Петров Иван');
    });

    it('без сотрудника в истории — без имени, а не «неизвестный»', async () => {
        const [, , comment] = await orderEvents(1);
        expect(comment.who).toBeNull();
        expect(comment.label).toBe('Комментарий менеджера');
    });

    it('строкой читается без латиницы', async () => {
        const text = eventsToText(await orderEvents(1));
        expect(text[0]).toContain('Статус: Новый → Согласование отмены (Петров Иван)');
        expect(text.join(' ')).not.toContain('custom_');
    });
});
