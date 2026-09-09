import mysql from 'mysql2/promise';

// Выполнение запросов к внешней базе на MySQL.
//
// Тот же замысел, что и у Postgres-варианта, но всё сказано по-мускульному:
// вместо SET TRANSACTION READ ONLY — START TRANSACTION READ ONLY, вместо $1 — ?.
// Общего кода у движков ровно столько, сколько его есть на самом деле: делать
// вид, что диалекты взаимозаменяемы, — это будущая ошибка в запросе к боевой
// базе цеха.

const pools = new Map<string, mysql.Pool>();

function getPool(key: string, url: string): mysql.Pool {
    const existing = pools.get(key);
    if (existing) return existing;

    const pool = mysql.createPool({
        uri: url,
        connectionLimit: 2,        // чужая база, много соединений держать незачем
        connectTimeout: 10_000,
        waitForConnections: true,
        // Главная строка в этом файле. Пока multipleStatements выключен, приписать
        // второй оператор через точку с запятой невозможно на уровне драйвера —
        // ниже и надёжнее, чем текстовая проверка. Включать нельзя никогда.
        multipleStatements: false,
        // Кодировка задаётся здесь, а не отдаётся на волю строки подключения.
        // Проверено на живом MySQL 8 с колонками в cp1251 (как в ЦехУспехе —
        // это программа на Delphi): при соединении в latin1 русский текст
        // приходит как «????», а запрос «WHERE NameStatus = 'В производстве'»
        // возвращает 0 строк из 2 — БЕЗ ОШИБКИ. Тамара сделала бы вывод, что
        // заказов нет. Явная настройка перебивает «?charset=» в самом URL —
        // это тоже проверено, а строку подключения вставляет человек.
        charset: 'utf8mb4',
        // BIGINT и DECIMAL приходят СТРОКАМИ, включая COUNT(*). Это осознанно:
        // идентификатор наряда легко больше 2^53, а молча округлённый номер —
        // ровно тот случай, когда ошибку замечают через месяц; деньги в double
        // тоже терять нельзя. Плата за это — Number() в месте использования,
        // и лучше пусть тип будет неудобным, но одинаковым, чем меняется от
        // величины значения.
        supportBigNumbers: true,
        bigNumberStrings: true,
        decimalNumbers: false,
        dateStrings: true,
    });
    pools.set(key, pool);
    return pool;
}

/** Параметры подставляются драйвером, в тексте запроса они выглядят как ?. */
export async function runMysql<T>(key: string, url: string, query: string, params: unknown[]): Promise<T[]> {
    const pool = getPool(key, url);
    const conn = await pool.getConnection();
    try {
        await conn.query('START TRANSACTION READ ONLY');
        try {
            // execute, а не query: значения уходят отдельно от текста запроса.
            const [rows] = await conn.execute(query, params as any[]);
            return rows as T[];
        } finally {
            // Всегда ROLLBACK, а не COMMIT: коммитить в read-only транзакции
            // нечего, а откат снимает её при любом исходе, включая ошибку.
            await conn.query('ROLLBACK').catch(() => {});
        }
    } finally {
        conn.release();
    }
}

export async function closeMysql(): Promise<void> {
    await Promise.all(Array.from(pools.values()).map((pool) => pool.end()));
    pools.clear();
}
