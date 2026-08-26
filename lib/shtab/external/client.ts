import { assertReadOnlyQuery } from '@/lib/shtab/external/guard';
import type { ExternalEngine } from '@/lib/shtab/external/guard';
import { closeMysql, runMysql } from '@/lib/shtab/external/mysql';
import { closePostgres, runPostgres } from '@/lib/shtab/external/postgres';

// Доступ к внешним базам группы — ЦехУспех, конструкторское бюро, маркетинг.
// Только чтение, и это защищено втройне:
//
//   1. Роль в базе, которой выдан один лишь SELECT (как её завести — в
//      docs/shtab/TAMARA.md). Роль заводит человек, поэтому она может оказаться
//      шире, чем задумано, — отсюда остальные два рубежа.
//   2. Проверка текста запроса — lib/shtab/external/guard.ts.
//   3. Read-only транзакция вокруг каждого запроса — в файле своего движка.
//
// Базы на разных движках: ЦехУспех — MySQL, остальные пока неизвестны. Этот файл
// остаётся лицом слоя, а различия движков живут в mysql.ts и postgres.ts.

export type { ExternalEngine } from '@/lib/shtab/external/guard';
export { assertReadOnlyQuery } from '@/lib/shtab/external/guard';

export type ExternalDb = 'tseh' | 'kb' | 'marketing';

export const EXTERNAL_DB_TITLES: Record<ExternalDb, string> = {
    tseh: 'ЦехУспех',
    kb: 'Конструкторское бюро',
    marketing: 'Маркетинг',
};

const ENV_KEYS: Record<ExternalDb, string> = {
    tseh: 'SHTAB_DB_TSEH_URL',
    kb: 'SHTAB_DB_KB_URL',
    marketing: 'SHTAB_DB_MARKETING_URL',
};

export function externalDbConfigured(db: ExternalDb): boolean {
    return Boolean(process.env[ENV_KEYS[db]]?.trim());
}

function requireUrl(db: ExternalDb): string {
    const url = process.env[ENV_KEYS[db]]?.trim();
    if (!url) throw new Error(`База «${EXTERNAL_DB_TITLES[db]}» не настроена: нет ${ENV_KEYS[db]}`);
    return url;
}

/**
 * Движок определяется схемой строки подключения, а не таблицей в коде.
 *
 * Так, а не жёстким соответствием «tseh → MySQL», по двум причинам: базу можно
 * перевезти на другой движок, не трогая код, и опечатка в схеме падает здесь
 * внятно, а не превращается двумя слоями ниже в невразумительную ошибку драйвера.
 */
export function engineOfUrl(url: string, envKey = 'строка подключения'): ExternalEngine {
    const scheme = url.slice(0, url.indexOf('://')).toLowerCase();
    if (scheme === 'mysql' || scheme === 'mariadb') return 'mysql';
    if (scheme === 'postgres' || scheme === 'postgresql') return 'postgres';
    throw new Error(
        `${envKey}: неизвестный движок «${scheme || url.slice(0, 20)}». ` +
            'Ожидается mysql:// или postgres://',
    );
}

/** На каком движке работает база. Нужен коду инструментов: плейсхолдеры разные. */
export function externalEngine(db: ExternalDb): ExternalEngine {
    return engineOfUrl(requireUrl(db), ENV_KEYS[db]);
}

/**
 * Выполняет один SELECT во внешней базе.
 *
 * Параметры передаются отдельно от текста запроса — подстановка значений в
 * строку означала бы инъекцию, а часть значений приходит из аргументов
 * инструмента, то есть в конечном счёте от модели.
 *
 * Плейсхолдеры у движков разные и взаимозаменяемыми не притворяются: в Postgres
 * это $1, $2, в MySQL — ?. Текст запроса пишется под движок базы; какой он,
 * говорит externalEngine().
 */
export async function queryExternal<T = Record<string, unknown>>(
    db: ExternalDb,
    query: string,
    params: unknown[] = [],
): Promise<T[]> {
    const url = requireUrl(db);
    const engine = engineOfUrl(url, ENV_KEYS[db]);

    assertReadOnlyQuery(query, engine);

    return engine === 'mysql'
        ? runMysql<T>(db, url, query, params)
        : runPostgres<T>(db, url, query, params);
}

/** Закрывает соединения — нужно скриптам, чтобы процесс не висел. */
export async function closeExternal(): Promise<void> {
    await Promise.all([closePostgres(), closeMysql()]);
}
