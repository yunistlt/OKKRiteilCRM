/**
 * Поиск заказов находит по городу.
 *
 * Жалоба Ирины Гордеевой 05.11.2026 (доработка 79): «Не ищет поиск по городу».
 * В orders.search_text лежали имя, контрагент, почта, телефоны и ИНН — адреса
 * не было вовсе, так что по городу не находилось ничего.
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

const migrations = path.join(process.cwd(), 'migrations');

/** Последняя по дате миграция, переопределяющая строку поиска заказа. */
function latestSearchTextMigration(): string {
    const files = fs.readdirSync(migrations)
        .filter((name) => name.endsWith('.sql'))
        .filter((name) => fs.readFileSync(path.join(migrations, name), 'utf8')
            .includes('FUNCTION public.orders_fill_search_text'))
        .sort();
    expect(files.length).toBeGreaterThan(0);
    return fs.readFileSync(path.join(migrations, files[files.length - 1]), 'utf8');
}

describe('строка поиска заказа', () => {
    const sql = latestSearchTextMigration();

    it('включает кастом-поле «Город доставки (менеджерам ОП)»', () => {
        // Менеджеры ведут город прежде всего здесь, и ищут по нему: у заказов
        // 900493 и 900176 из жалобы адрес доставки пуст, а поле заполнено.
        expect(sql).toContain("'gorod_dostavki_menedzheram_op'");
    });

    it('включает город, регион и адрес доставки', () => {
        expect(sql).toContain("delivery->'address'->>'city'");
        expect(sql).toContain("delivery->'address'->>'region'");
        expect(sql).toContain("delivery->'address'->>'text'");
    });

    it('не растеряла прежние поля: контакты и ИНН', () => {
        for (const field of ['customer_name', 'contragent_name', 'NEW.email', 'NEW.phone', "contragent->>'INN'"]) {
            expect(sql).toContain(field);
        }
    });

    it('пересчёт старых строк идёт порциями, а не одним UPDATE', () => {
        const backfill = fs.readFileSync(path.join(process.cwd(), 'scripts/backfill-orders-search-city.js'), 'utf8');
        expect(backfill).toContain('LIMIT ${CHUNK}');
        expect(backfill).toMatch(/PAUSE_MS\s*=\s*\d+/);
        // Писать можно только с ключом: случайный запуск ничего не трогает.
        expect(backfill).toContain("process.argv.includes('--apply')");
    });
});
