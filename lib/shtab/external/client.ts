import postgres from 'postgres';

// Доступ к внешним базам группы — ЦехУспех, конструкторское бюро, маркетинг.
// Только чтение, и это защищено дважды.
//
// Первый слой — на стороне базы: подключаться следует ролью, которой выдан один
// лишь GRANT SELECT (как это завести, описано в docs/shtab/TAMARA.md).
//
// Второй слой — здесь: каждый запрос выполняется в транзакции, начатой с
// SET TRANSACTION READ ONLY, и текст запроса проверяется на то, что это
// единственный SELECT. Одного слоя мало: роль может оказаться шире, чем
// задумано (её заводит человек), а код может ошибиться. Это чужие боевые базы,
// и цена ошибки — не наши данные.
//
// Модель до этого слоя не достаёт: SQL пишется в коде, ей достаются именованные
// инструменты с типизированными параметрами.

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

const pools = new Map<ExternalDb, postgres.Sql>();

function getPool(db: ExternalDb): postgres.Sql {
    const existing = pools.get(db);
    if (existing) return existing;

    const url = process.env[ENV_KEYS[db]]?.trim();
    if (!url) throw new Error(`База «${EXTERNAL_DB_TITLES[db]}» не настроена: нет ${ENV_KEYS[db]}`);

    const sql = postgres(url, {
        max: 2,                 // чужая база, много соединений держать незачем
        idle_timeout: 20,
        connect_timeout: 10,
        prepare: false,         // пулеры вроде pgbouncer не любят prepared statements
        onnotice: () => {},
    });
    pools.set(db, sql);
    return sql;
}

// Слова, с которых начинается изменение данных. Проверено на живой базе:
// «WITH x AS (INSERT ... RETURNING id) SELECT id FROM x» — это один оператор,
// он начинается со слова WITH, в нём нет точки с запятой, и он действительно
// пишет в таблицу. Ради этого случая проверка и существует.
//
// Слов вроде SET, COMMENT, COPY, LOCK здесь намеренно нет: без точки с запятой
// они в запрос не попадут, а как имена колонок встречаются сплошь и рядом —
// «comment» в базе маркетинга отвергался бы на ровном месте.
const FORBIDDEN =
    /\b(insert|update|delete|merge|truncate|drop|alter|create|grant|revoke)\b/i;

/** Убирает комментарии, строковые литералы и закавыченные имена. */
function stripNoise(query: string): string {
    return query
        .replace(/--[^\n]*/g, ' ')          // однострочные комментарии
        .replace(/\/\*[\s\S]*?\*\//g, ' ')   // блочные
        .replace(/\$([A-Za-z_]\w*)?\$[\s\S]*?\$\1?\$/g, " '' ") // долларовые литералы
        .replace(/'(?:[^']|'')*'/g, " '' ")  // строковые литералы
        .replace(/"(?:[^"]|"")*"/g, ' _ ');  // закавыченные идентификаторы
}

/**
 * Запрос обязан быть одним SELECT (допускается ведущий WITH).
 *
 * Это второй слой защиты, не единственный: первый — роль в базе, которой выдан
 * один лишь GRANT SELECT, третий — SET TRANSACTION READ ONLY в queryExternal.
 */
export function assertReadOnlyQuery(query: string): void {
    const stripped = stripNoise(query).trim();

    if (!stripped) throw new Error('Пустой запрос');

    // Точка с запятой внутри текста запроса — почти всегда попытка приписать
    // второй оператор. Хвостовую отбрасываем, любую другую считаем ошибкой.
    const body = stripped.replace(/;\s*$/, '');
    if (body.includes(';')) throw new Error('Во внешнюю базу разрешён только один оператор');

    if (!/^(select|with)\b/i.test(body)) {
        throw new Error('Во внешнюю базу разрешён только SELECT');
    }
    const match = body.match(FORBIDDEN);
    if (match) throw new Error(`Во внешнюю базу разрешён только SELECT, найдено: ${match[1].toUpperCase()}`);
}

/**
 * Выполняет один SELECT во внешней базе.
 *
 * Параметры передаются отдельно от текста запроса — подстановка значений в
 * строку означала бы инъекцию, а часть значений приходит из аргументов
 * инструмента, то есть в конечном счёте от модели.
 */
export async function queryExternal<T = Record<string, unknown>>(
    db: ExternalDb,
    query: string,
    params: unknown[] = [],
): Promise<T[]> {
    assertReadOnlyQuery(query);
    const sql = getPool(db);

    return sql.begin(async (tx) => {
        await tx.unsafe('SET TRANSACTION READ ONLY');
        const rows = await tx.unsafe(query, params as any[]);
        return rows as unknown as T[];
    }) as Promise<T[]>;
}

/** Закрывает соединения — нужно скриптам, чтобы процесс не висел. */
export async function closeExternal(): Promise<void> {
    await Promise.all(Array.from(pools.values()).map((sql) => sql.end({ timeout: 5 })));
    pools.clear();
}
