/**
 * Имя статуса — из одной таблицы.
 *
 * Названия статусов лежали сразу в трёх наших таблицах: на доске
 * «Статусы и переходы» (`crm_statuses`) и ещё в двух, оставшихся от импорта
 * (`statuses`, `retailcrm_dictionaries`). Экраны читали кто во что горазд, и
 * статус, заведённый на доске, показывался кодом: «dubl-zayavki» вместо
 * «Дубль заявки» (25.10.2026).
 *
 * Сторож: новое чтение ИМЕНИ статуса мимо `lib/own-crm/status-code.ts`
 * роняет тест. Логика по рабочим статусам и группам из старых таблиц пока
 * остаётся — она в списке ниже и разбирается отдельно.
 */
import { describe, expect, it } from 'vitest';
import { execSync } from 'node:child_process';

/** Файлы, где чтение имени статуса из старых таблиц ещё не разобрано. */
const ЕЩЁ_НЕ_РАЗОБРАНО = [
    // Экран «Статусы и переходы» — он этими таблицами и управляет.
    'app/settings/statuses/actions.ts',
    'app/settings/statuses/page.tsx',
    // Синхронизация справочников: пишет в таблицы, а не показывает людям.
    'app/api/sync/statuses/route.ts',
    'app/debug-db/page.tsx',
    // Оплаты и баллы ОКК: там не показ имени, а логика по этапу
    // (какие статусы считать производством, какие — закрытием). Разбирается
    // отдельно: ошибка в этих файлах стоит денег.
    'lib/payments/production.ts',
    'lib/payments/service.ts',
    'lib/okk-evaluator.ts',
    'app/api/ai/route-orders/route.ts',
    'app/api/orders/[id]/details/route.ts',
    'app/api/orders/list/route.ts',
];

function readersOfStatusNames(): string[] {
    const out = execSync(
        `grep -rln "from('statuses')\\|entity_type', 'status'" --include=*.ts --include=*.tsx app lib components || true`,
        { encoding: 'utf8' },
    );
    return out.split('\n').map((line) => line.trim()).filter(Boolean);
}

describe('имя статуса — из одной таблицы', () => {
    it('старые справочники статусов читают только разрешённые файлы', () => {
        const unexpected = readersOfStatusNames()
            .filter((file) => !ЕЩЁ_НЕ_РАЗОБРАНО.includes(file))
            .filter((file) => {
                const src = execSync(`cat ${JSON.stringify(file)}`, { encoding: 'utf8' });
                // Имя статуса — это `name` / `item_name`. Чтение is_working,
                // цвета и групп из старых таблиц сторож пока не трогает.
                return /from\('statuses'\)[\s\S]{0,120}?select\([^)]*\bname\b/.test(src)
                    || /select\([^)]*item_name[^)]*\)[\s\S]{0,160}?entity_type', 'status'/.test(src)
                    || /entity_type', 'status'[\s\S]{0,160}?item_name/.test(src);
            });

        expect(unexpected, 'имя статуса берём через lib/own-crm/status-code.ts').toEqual([]);
    });
});
