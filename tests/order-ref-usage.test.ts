import { readFileSync, readdirSync, statSync } from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';

/**
 * Номер заказа не равен его идентификатору.
 *
 * У заказов RetailCRM `number` и `order_id` совпадали, и код годами подставлял
 * одно вместо другого. Свои заказы нумеруются 900118 при `order_id` 900000118 —
 * и каждое такое место тихо перестало находить заказ. За два дня это всплыло
 * трижды: предпросмотр КП, поиск переписки, звонки в карточке качества.
 *
 * Тест держит границу: маршрут, которому в адрес приходит заказ, не ищет его
 * сам, а зовёт `resolveOrderRef` (lib/own-crm/order-ref.ts). Добавили новый
 * маршрут — либо используйте помощник, либо впишите сюда с объяснением.
 */
const ROOT = path.join(process.cwd(), 'app', 'api');

/** Маршруты, которым заказ в адрес не приходит или приходит заведомо как id. */
const ALLOWED = new Set<string>([
    // Конвейер зовёт сам себя уже разрешённым идентификатором.
    'app/api/cron/system-jobs/order-insight/route.ts',
]);

function routeFiles(dir: string): string[] {
    const out: string[] = [];
    for (const entry of readdirSync(dir)) {
        const full = path.join(dir, entry);
        if (statSync(full).isDirectory()) out.push(...routeFiles(full));
        else if (entry === 'route.ts') out.push(full);
    }
    return out;
}

describe('номер заказа и его идентификатор', () => {
    it('маршруты с заказом в адресе разбирают его общим помощником', () => {
        const offenders: string[] = [];

        for (const file of routeFiles(ROOT)) {
            const rel = path.relative(process.cwd(), file);
            if (ALLOWED.has(rel)) continue;

            // Нас интересуют только маршруты, куда заказ приходит параметром.
            const takesOrderParam = /\[(id|orderId|number)\]/.test(rel) && /orders?/i.test(rel);
            if (!takesOrderParam) continue;

            const source = readFileSync(file, 'utf8');
            if (source.includes('resolveOrderRef')) continue;

            // Поиск заказа своими руками по тому, что пришло в адресе.
            const looksUpOrder = /from\('orders'\)/.test(source)
                && /\.eq\('(order_id|id)',\s*(Number\()?\s*(params\.)?(id|orderId|rawId|key)/.test(source);

            if (looksUpOrder) offenders.push(rel);
        }

        expect(offenders, `Эти маршруты ищут заказ сами — используйте resolveOrderRef:\n${offenders.join('\n')}`)
            .toEqual([]);
    });
});
