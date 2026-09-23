import { describe, expect, it } from 'vitest';
import { LVZ_TABLES, lvzRead } from '@/lib/shtab/lvz';
import { SHTAB_TOOLS } from '@/lib/shtab/tamara-tools';

describe('доступ к базе соседнего проекта', () => {
    it('таблица вне белого списка не читается', async () => {
        // Белый список — это и есть решение о том, что Тамаре показывать:
        // в той базе есть админы, ключи и логи.
        const res: any = await lvzRead({ table: 'admins' });
        expect(res.available).toBe(false);
        expect(res.reason).toContain('не из списка');
    });

    it('в белом списке нет служебных таблиц', () => {
        for (const forbidden of ['admins', 'api_settings', 'logs', 'allowed_users']) {
            expect(Object.keys(LVZ_TABLES), forbidden).not.toContain(forbidden);
        }
    });

    it('у каждой разрешённой таблицы написано назначение', () => {
        // Без назначения модель угадывает по названию и путает расчёты
        // верстака с расчётами муфельной печи.
        for (const [table, purpose] of Object.entries(LVZ_TABLES)) {
            expect(purpose.trim().length, table).toBeGreaterThan(10);
        }
    });

    it('инструменты чтения объявлены и не умеют писать', () => {
        const names = SHTAB_TOOLS.map((t: any) => t.function.name);
        for (const need of ['lvz_tables', 'lvz_read', 'lvz_calc_summary', 'catalog_search', 'catalog_overview']) {
            expect(names, need).toContain(need);
        }
        const params = SHTAB_TOOLS.find((t: any) => t.function.name === 'lvz_read') as any;
        expect(Object.keys(params.function.parameters.properties)).not.toContain('write');
    });
});
