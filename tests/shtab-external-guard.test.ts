import { describe, expect, it } from 'vitest';
import { assertReadOnlyQuery, engineOfUrl } from '@/lib/shtab/external/client';
import type { ExternalEngine } from '@/lib/shtab/external/client';

// Слой «только чтение» перед чужими боевыми базами. Рубежей три: роль в базе,
// эта проверка текста и read-only транзакция. Здесь проверяется средний.

const ENGINES: ExternalEngine[] = ['postgres', 'mysql'];

const ok = (q: string, e: ExternalEngine) => expect(() => assertReadOnlyQuery(q, e), `${e}: ${q}`).not.toThrow();
const no = (q: string, e: ExternalEngine) => expect(() => assertReadOnlyQuery(q, e), `${e}: ${q}`).toThrow();

describe.each(ENGINES)('assertReadOnlyQuery (%s) — что пропускает', (engine) => {
    it('обычный SELECT', () => {
        ok('SELECT count(*) FROM naryad', engine);
        ok('  select id, nomer from naryad where massa_kg > 100  ', engine);
        ok('SELECT * FROM naryad;', engine); // хвостовая точка с запятой допустима
    });

    it('SELECT с ведущим CTE', () => {
        ok('WITH m AS (SELECT otkryt_na FROM naryad) SELECT * FROM m', engine);
    });

    it('колонки, чьи имена совпадают со служебными словами', () => {
        // «comment» в базе маркетинга — обычное дело: без точки с запятой
        // отдельным оператором это слово не станет.
        ok('SELECT comment, copy, lock FROM lead', engine);
        ok('SELECT setting FROM nastroyka', engine);
        ok('SELECT a FROM t WHERE call_id = 1', engine);
    });

    it('служебные слова внутри строковых литералов', () => {
        ok("SELECT id FROM lead WHERE istochnik = 'update reklamy'", engine);
        ok(`SELECT id FROM lead WHERE txt = 'он сказал ''drop'' и ушёл'`, engine);
        ok("SELECT id FROM t WHERE s = 'выгрузка into outfile'", engine);
        ok("SELECT id FROM t WHERE s = 'ставим for update'", engine);
    });

    it('комментарии в тексте запроса', () => {
        ok('SELECT id -- delete from naryad\n FROM naryad', engine);
        ok('SELECT id /* drop table naryad */ FROM naryad', engine);
        ok('SELECT id # truncate naryad\n FROM naryad', engine);
    });
});

describe.each(ENGINES)('assertReadOnlyQuery (%s) — что отбивает', (engine) => {
    it('прямые изменения данных', () => {
        no("INSERT INTO naryad (nomer) VALUES ('x')", engine);
        no("UPDATE naryad SET status = 'zakryt'", engine);
        no('DELETE FROM naryad', engine);
        no('TRUNCATE naryad', engine);
        no('DROP TABLE naryad', engine);
        no('ALTER TABLE naryad ADD COLUMN x int', engine);
        no('GRANT ALL ON naryad TO public', engine);
    });

    it('второй оператор через точку с запятой', () => {
        no('SELECT 1; DROP TABLE naryad', engine);
        no('SELECT 1 -- ok\n; TRUNCATE naryad', engine);
        no("SELECT 1; INSERT INTO naryad (nomer) VALUES ('x');", engine);
    });

    it('пишущий CTE — один оператор, без точки с запятой, и он всё-таки пишет', () => {
        // Проверено на живом PostgreSQL 16: такой запрос вставляет строку.
        // Начинается он со слова WITH, поэтому проверки «первое слово» мало.
        no("WITH x AS (INSERT INTO naryad (nomer) VALUES ('обход') RETURNING id) SELECT id FROM x", engine);
        no('WITH x AS (DELETE FROM naryad RETURNING id) SELECT id FROM x', engine);
    });

    it('запись файла на сервере базы', () => {
        // Начинается со слова SELECT, один оператор, ни одного «пишущего» слова —
        // и пишет файл. Специфика MySQL, но запрещаем на обоих движках.
        no("SELECT * FROM naryad INTO OUTFILE '/tmp/utek.csv'", engine);
        no("SELECT * FROM naryad INTO DUMPFILE '/tmp/utek.bin'", engine);
        no('SELECT * FROM naryad into   outfile "/tmp/utek.csv"', engine);
    });

    it('блокировки чужой боевой базы', () => {
        no('SELECT * FROM naryad FOR UPDATE', engine);
        no('SELECT * FROM naryad FOR SHARE', engine);
        no('SELECT * FROM naryad LOCK IN SHARE MODE', engine);
    });

    it('не-SELECT в начале', () => {
        no('EXPLAIN ANALYZE SELECT 1', engine);
        no('COPY naryad TO STDOUT', engine);
        no('CALL raschet_pribyli(1)', engine);
        no('SET search_path TO public', engine);
    });

    it('пустой запрос и запрос из одних комментариев', () => {
        no('', engine);
        no('   ', engine);
        no('-- только комментарий', engine);
        no('/* и этот */', engine);
        no('# и по-мускульному', engine);
    });
});

describe('сообщение об ошибке называет настоящую причину', () => {
    it('FOR UPDATE — про блокировку, а не про слово UPDATE', () => {
        // Иначе человек будет искать в запросе несуществующий UPDATE.
        expect(() => assertReadOnlyQuery('SELECT 1 FROM t FOR UPDATE', 'mysql')).toThrow(/[Бб]локировк/);
    });

    it('INTO OUTFILE — про запись файла', () => {
        expect(() => assertReadOnlyQuery("SELECT 1 INTO OUTFILE '/tmp/x'", 'mysql')).toThrow(/файл/);
    });
});

describe('закавыченные идентификаторы не сбивают проверку', () => {
    it('в кавычках Postgres и в обратных кавычках MySQL', () => {
        ok('SELECT "insert" FROM zhurnal', 'postgres');
        ok('SELECT `insert` FROM `update` WHERE `delete` = 1', 'mysql');
    });
});

describe('engineOfUrl — движок по схеме строки подключения', () => {
    it('узнаёт mysql', () => {
        expect(engineOfUrl('mysql://u:p@host:3306/db')).toBe('mysql');
        expect(engineOfUrl('mariadb://u:p@host:3306/db')).toBe('mysql');
        expect(engineOfUrl('MySQL://u:p@host:3306/db')).toBe('mysql');
    });

    it('узнаёт postgres в обоих написаниях', () => {
        expect(engineOfUrl('postgres://u:p@host:5432/db')).toBe('postgres');
        expect(engineOfUrl('postgresql://u:p@host:5432/db?sslmode=require')).toBe('postgres');
    });

    it('на чужой схеме падает внятно и называет переменную окружения', () => {
        // Иначе опечатка превратилась бы двумя слоями ниже в невразумительную
        // ошибку драйвера, и искать её пришлось бы долго.
        expect(() => engineOfUrl('mssql://u:p@host/db', 'SHTAB_DB_KB_URL')).toThrow(/SHTAB_DB_KB_URL/);
        expect(() => engineOfUrl('mssql://u:p@host/db')).toThrow(/mssql/);
        expect(() => engineOfUrl('просто строка')).toThrow();
    });
});
