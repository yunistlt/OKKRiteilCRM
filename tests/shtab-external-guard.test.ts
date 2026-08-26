import { describe, expect, it } from 'vitest';
import { assertReadOnlyQuery } from '@/lib/shtab/external/client';

// Слой «только чтение» перед чужими боевыми базами. Роль в базе — первый рубеж,
// SET TRANSACTION READ ONLY — третий, а это проверка второго.

const ok = (q: string) => expect(() => assertReadOnlyQuery(q)).not.toThrow();
const no = (q: string) => expect(() => assertReadOnlyQuery(q)).toThrow();

describe('assertReadOnlyQuery — что пропускает', () => {
    it('обычный SELECT', () => {
        ok('SELECT count(*) FROM naryad');
        ok('  select id, nomer from naryad where massa_kg > $1  ');
        ok('SELECT * FROM naryad;'); // хвостовая точка с запятой допустима
    });

    it('SELECT с ведущим CTE', () => {
        ok('WITH mesyacy AS (SELECT date_trunc(\'month\', otkryt_na) AS m FROM naryad) SELECT m FROM mesyacy');
    });

    it('колонки, чьи имена совпадают со служебными словами', () => {
        // «comment» в базе маркетинга — обычное дело, отвергать его не за что:
        // без точки с запятой отдельным оператором это слово не станет.
        ok('SELECT comment, copy, lock FROM lead');
        ok('SELECT setting FROM nastroyka');
        ok('SELECT a FROM t WHERE call_id = $1');
    });

    it('служебные слова внутри строковых литералов', () => {
        ok("SELECT id FROM lead WHERE istochnik = 'update reklamy'");
        ok(`SELECT id FROM lead WHERE txt = 'он сказал ''drop'' и ушёл'`);
        ok('SELECT id FROM t WHERE x = $tag$ delete from naryad $tag$');
    });

    it('служебные слова внутри закавыченных имён', () => {
        ok('SELECT "insert" FROM zhurnal');
    });

    it('комментарии в тексте запроса', () => {
        ok('SELECT id -- delete from naryad\n FROM naryad');
        ok('SELECT id /* drop table naryad */ FROM naryad');
    });
});

describe('assertReadOnlyQuery — что отбивает', () => {
    it('прямые изменения данных', () => {
        no("INSERT INTO naryad (nomer) VALUES ('x')");
        no("UPDATE naryad SET status = 'zakryt'");
        no('DELETE FROM naryad');
        no('TRUNCATE naryad');
        no('DROP TABLE naryad');
        no('ALTER TABLE naryad ADD COLUMN x int');
        no('GRANT ALL ON naryad TO public');
    });

    it('второй оператор через точку с запятой', () => {
        no('SELECT 1; DROP TABLE naryad');
        no('SELECT 1 -- ok\n; TRUNCATE naryad');
        no("SELECT 1; INSERT INTO naryad (nomer) VALUES ('x');");
    });

    it('пишущий CTE — один оператор, без точки с запятой, и он всё-таки пишет', () => {
        // Проверено на живом PostgreSQL 16: такой запрос действительно вставляет
        // строку. Начинается он со слова WITH, поэтому проверки «первое слово» мало.
        no("WITH x AS (INSERT INTO naryad (nomer) VALUES ('обход') RETURNING id) SELECT id FROM x");
        no('WITH x AS (DELETE FROM naryad RETURNING id) SELECT id FROM x');
        no("WITH x AS (UPDATE naryad SET status = 'z' RETURNING id) SELECT id FROM x");
        no('WITH x AS (MERGE INTO naryad USING t ON true WHEN MATCHED THEN DELETE RETURNING id) SELECT id FROM x');
    });

    it('не-SELECT в начале', () => {
        no('EXPLAIN ANALYZE SELECT 1');
        no('COPY naryad TO STDOUT');
        no('SET search_path TO public');
    });

    it('пустой запрос и запрос из одних комментариев', () => {
        no('');
        no('   ');
        no('-- только комментарий');
        no('/* и этот */');
    });
});
