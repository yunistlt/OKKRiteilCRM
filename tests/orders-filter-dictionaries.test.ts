/**
 * Справочники значений фильтра.
 *
 * У «категории товара» имя поля заказа и имя справочника разные: поле зовётся
 * `typ_castomer`, значения лежат в `kategoriya_klienta`. Фильтр спрашивал
 * справочник по имени поля, находил пусто, и выбрать категорию было нельзя
 * (12.10.2026).
 */
import { describe, it, expect } from 'vitest';
import { CUSTOM_FIELD_CODES, CUSTOM_FIELD_DICTIONARIES } from '@/lib/orders-filter';

describe('коды полей и справочников', () => {
    it('категория товара: поле одно, справочник другой', () => {
        expect(CUSTOM_FIELD_CODES.category).toBe('typ_castomer');
        expect(CUSTOM_FIELD_DICTIONARIES.category).toBe('kategoriya_klienta');
    });

    it('у сферы деятельности имена совпадают', () => {
        expect(CUSTOM_FIELD_DICTIONARIES.sfera).toBe(CUSTOM_FIELD_CODES.sfera);
    });

    it('справочник категории не равен имени поля — иначе список снова опустеет', () => {
        expect(CUSTOM_FIELD_DICTIONARIES.category).not.toBe(CUSTOM_FIELD_CODES.category);
    });
});
