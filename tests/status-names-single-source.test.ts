/**
 * Справочник статусов — один: `crm_statuses`.
 *
 * Статусы лежали сразу в трёх таблицах: `crm_statuses` и ещё две, оставшиеся
 * от импорта (`statuses`, `retailcrm_dictionaries`). Экраны читали кто во что
 * горазд, и статус показывался кодом: «dubl-zayavki» вместо «Дубль заявки»
 * (25.10.2026). Теперь имя, цвет, этап и норматив берутся из `crm_statuses`
 * через `lib/own-crm/status-code.ts`.
 *
 * Сторож: любое обращение к старым таблицам за статусами роняет тест.
 */
import { describe, expect, it } from 'vitest';
import { execSync } from 'node:child_process';

/** Файлы, где чтение имени статуса из старых таблиц ещё не разобрано. */
const ЕЩЁ_НЕ_РАЗОБРАНО: string[] = [];

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
