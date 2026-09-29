/**
 * Слой чтения заказа: поля берём из колонок, а человеку показываем русские
 * названия из справочников RetailCRM. Латиница вроде prioriry_number в
 * интерфейс и в промпт агента попадать не должна.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { data } = vi.hoisted(() => ({
    data: {
        fields: [
            { code: 'prioriry_number', name: 'Приоритет', type: 'integer', dictionary: null },
            { code: 'typ_castomer', name: 'Категория товара', type: 'dictionary', dictionary: 'kategoriya_klienta' },
            { code: 'dokumentooborot_cherez_edo', name: 'Документооборот через ЭДО', type: 'boolean', dictionary: null },
            { code: 'data_kontakta', name: 'Дата следующего контакта', type: 'date', dictionary: null },
        ],
        dictionaries: [
            { dictionary_code: 'kategoriya_klienta', item_code: '5', item_name: 'Муфельные печи' },
        ],
    },
}));

vi.mock('@/utils/supabase', () => {
    const chain = (rows: any[]) => {
        const c: any = {
            eq: () => c,
            not: () => c,
            then: (res: any) => res({ data: rows, error: null }),
        };
        return c;
    };
    return {
        supabase: {
            from(table: string) {
                return {
                    select: () => chain(table === 'retailcrm_custom_fields' ? data.fields : data.dictionaries),
                };
            },
        },
    };
});

import { fieldName, fieldValue, resetFieldNamesCache } from '@/lib/own-crm/field-names';
import { describeOrder } from '@/lib/own-crm/orders';

beforeEach(() => resetFieldNamesCache());

describe('названия полей заказа', () => {
    it('отдаёт русское название вместо кода', async () => {
        expect(await fieldName('prioriry_number')).toBe('Приоритет');
    });

    it('неизвестное поле отдаёт кодом — пробел видно, а не прячется', async () => {
        expect(await fieldName('pole_kotorogo_net')).toBe('pole_kotorogo_net');
    });

    it('код справочника разворачивает в название', async () => {
        expect(await fieldValue('typ_castomer', '5')).toBe('Муфельные печи');
    });

    it('да/нет по-русски', async () => {
        expect(await fieldValue('dokumentooborot_cherez_edo', true)).toBe('да');
        expect(await fieldValue('dokumentooborot_cherez_edo', false)).toBe('нет');
    });

    it('пустое значение не показываем', async () => {
        expect(await fieldValue('prioriry_number', null)).toBeNull();
        expect(await fieldValue('prioriry_number', '')).toBeNull();
    });
});

describe('заказ человеческим языком', () => {
    it('собирает только заполненные поля и без латиницы в названиях', async () => {
        const facts = await describeOrder({
            id: 1,
            prioriry_number: 3,
            typ_castomer: '5',
            dokumentooborot_cherez_edo: true,
            data_kontakta: null,
        } as any);

        expect(facts).toEqual([
            { label: 'Приоритет', value: '3' },
            { label: 'Категория товара', value: 'Муфельные печи' },
            { label: 'Документооборот через ЭДО', value: 'да' },
        ]);
    });
});
