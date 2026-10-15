/**
 * ЗАКОН: в RetailCRM мы ничего не пишем.
 *
 * С 15.10.2026 своя CRM — единственная система учёта, RetailCRM остаётся
 * архивом на чтение: заказы, клиенты, оплаты, файлы и статусы живут у нас.
 * Этот тест — сторож на будущее: он падает, если в коде снова появится запрос,
 * который МЕНЯЕТ что-то на той стороне.
 *
 * Почему тестом, а не рубильником в рантайме: рубильник уже был
 * (`retailcrm_outbound_writes` + `outbound-guard`) и отклонял правку целиком —
 * заказ переставал редактироваться, а человек видел пустую ошибку
 * (инцидент 09.10.2026). Запрет на уровне кода дешевле и честнее: ломается
 * сборка у того, кто написал запись, а не работа менеджера.
 *
 * Если RetailCRM снова понадобится на запись — это решение владельца, и тогда
 * правится этот тест вместе с кодом, осознанно.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(__dirname, '..');
const SCAN_DIRS = ['lib', 'app', 'scripts', 'components'];
const CODE_EXT = new Set(['.ts', '.tsx', '.js', '.mjs']);

/** Пути RetailCRM API, которые меняют данные на той стороне. */
const WRITE_PATHS = [
    /api\/v5\/[^'"`\s]*\/create/,
    /api\/v5\/[^'"`\s]*\/edit/,
    /api\/v5\/[^'"`\s]*\/upload/,
    /api\/v5\/[^'"`\s]*\/delete/,
    /api\/v5\/files\/[^'"`\s]*\/edit/,
];

/** Ссылка в интерфейс RetailCRM — не запись, но и не наша карточка. */
const CRM_ORDER_LINK = /retailcrm\.ru\/orders\//;

function walk(dir: string): string[] {
    const found: string[] = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) found.push(...walk(full));
        else if (CODE_EXT.has(path.extname(entry.name))) found.push(full);
    }
    return found;
}

function codeFiles(): string[] {
    return SCAN_DIRS.flatMap((d) => {
        const full = path.join(ROOT, d);
        return fs.existsSync(full) ? walk(full) : [];
    });
}

describe('RetailCRM — только на чтение (ЗАКОН)', () => {
    it('в коде нет запросов, меняющих данные в RetailCRM', () => {
        const offenders: string[] = [];

        for (const file of codeFiles()) {
            const text = fs.readFileSync(file, 'utf8');
            if (!text.includes('api/v5')) continue;

            text.split('\n').forEach((line, i) => {
                // Комментарии не считаем: там объясняют, почему так больше не делаем.
                const code = line.trim();
                if (code.startsWith('//') || code.startsWith('*') || code.startsWith('/*')) return;
                if (WRITE_PATHS.some((re) => re.test(line))) {
                    offenders.push(`${path.relative(ROOT, file)}:${i + 1} → ${code.slice(0, 100)}`);
                }
            });
        }

        expect(offenders, `Запись в RetailCRM запрещена. Заказ, статус, оплату, клиента и файлы\n`
            + `пишем у себя: editOrder / insertOwnOrder / addOwnPayment / order_files.\n`
            + `Найдено:\n${offenders.join('\n')}`).toEqual([]);
    });

    it('номер заказа ведёт в нашу карточку, а не в RetailCRM', () => {
        const offenders: string[] = [];

        for (const file of codeFiles()) {
            const text = fs.readFileSync(file, 'utf8');
            text.split('\n').forEach((line, i) => {
                const code = line.trim();
                if (code.startsWith('//') || code.startsWith('*') || code.startsWith('/*')) return;
                if (CRM_ORDER_LINK.test(line)) {
                    offenders.push(`${path.relative(ROOT, file)}:${i + 1} → ${code.slice(0, 100)}`);
                }
            });
        }

        expect(offenders, `Заказ открывается у нас: /orders?order=<номер> (OrderNumberLink).\n`
            + `Ссылки в RetailCRM уводят человека в архив.\nНайдено:\n${offenders.join('\n')}`).toEqual([]);
    });
});
