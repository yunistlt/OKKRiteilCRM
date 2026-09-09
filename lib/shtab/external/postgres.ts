import postgres from 'postgres';

// Выполнение запросов к внешней базе на PostgreSQL.
//
// Третий рубеж защиты от записи живёт здесь: каждый запрос выполняется в
// транзакции, начатой с SET TRANSACTION READ ONLY. Первый — роль в базе, второй
// — проверка текста запроса (lib/shtab/external/guard.ts).

const pools = new Map<string, postgres.Sql>();

function getPool(key: string, url: string): postgres.Sql {
    const existing = pools.get(key);
    if (existing) return existing;

    const sql = postgres(url, {
        max: 2,                 // чужая база, много соединений держать незачем
        idle_timeout: 20,
        connect_timeout: 10,
        prepare: false,         // пулеры вроде pgbouncer не любят prepared statements
        onnotice: () => {},
    });
    pools.set(key, sql);
    return sql;
}

/** Параметры подставляются драйвером, в тексте запроса они выглядят как $1, $2. */
export async function runPostgres<T>(key: string, url: string, query: string, params: unknown[]): Promise<T[]> {
    const sql = getPool(key, url);
    return sql.begin(async (tx) => {
        await tx.unsafe('SET TRANSACTION READ ONLY');
        const rows = await tx.unsafe(query, params as any[]);
        return rows as unknown as T[];
    }) as Promise<T[]>;
}

export async function closePostgres(): Promise<void> {
    await Promise.all(Array.from(pools.values()).map((sql) => sql.end({ timeout: 5 })));
    pools.clear();
}
