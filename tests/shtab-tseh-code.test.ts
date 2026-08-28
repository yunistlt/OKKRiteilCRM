import { describe, expect, it } from 'vitest';
import {
    chunkPascal,
    codeFingerprint,
    docsFromDump,
    docsFromPascal,
    parseFunctions,
    parseTables,
} from '@/lib/shtab/tseh-code';

// Разбор исходников ЦехУспеха перед укладкой в РАГ. Проверяется то, от чего
// зависит осмысленность ответов Тамары: функция не должна обрываться на первом
// END внутри IF, а процедура Delphi — разрезаться посередине.

const DUMP = `
DROP TABLE IF EXISTS \`Orders\`;
CREATE TABLE \`Orders\` (
  \`ID\` int(11) NOT NULL AUTO_INCREMENT,
  \`DateDelivery\` datetime DEFAULT NULL,
  PRIMARY KEY (\`ID\`),
  KEY \`ID\` (\`ID\`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

DELIMITER ;;
CREATE DEFINER=\`gb_zmk\`@\`%\` FUNCTION \`SalaryOrder\`(TIDOrder INT) RETURNS double
BEGIN
    DECLARE T DOUBLE;
    IF T IS NULL THEN
      SET T = 0;
    END IF;
    RETURN T;
  END ;;
CREATE DEFINER=\`gb_zmk\`@\`%\` PROCEDURE \`RecalcOrder\`(TIDOrder INT)
BEGIN
    UPDATE Orders SET ID = ID WHERE ID = TIDOrder;
  END ;;
DELIMITER ;
`;

describe('разбор дампа MySQL', () => {
    it('берёт функции целиком, а не до первого END', () => {
        const fns = parseFunctions(DUMP);
        const salary = fns.find((f) => f.name === 'SalaryOrder');
        expect(salary).toBeDefined();
        // END IF внутри тела не должен обрывать разбор.
        expect(salary!.body).toContain('END IF');
        expect(salary!.body).toContain('RETURN T');
    });

    it('процедуры берёт тоже — расчёты живут и в них', () => {
        expect(parseFunctions(DUMP).map((f) => f.name)).toContain('RecalcOrder');
    });

    it('таблицы: колонки с типами, без ключей и без данных', () => {
        const tables = parseTables(DUMP);
        expect(tables).toHaveLength(1);
        expect(tables[0].name).toBe('Orders');
        expect(tables[0].columns).toEqual([
            'ID — int(11) NOT NULL AUTO_INCREMENT',
            'DateDelivery — datetime DEFAULT NULL',
        ]);
    });

    it('каждая запись помнит источник и уникальный slug', () => {
        const docs = docsFromDump(DUMP, 'gb_zmk_схема.sql');
        expect(docs.every((d) => d.sourceRef === 'gb_zmk_схема.sql')).toBe(true);
        expect(new Set(docs.map((d) => d.slug)).size).toBe(docs.length);
        expect(docs.map((d) => d.slug)).toContain('function:SalaryOrder');
        expect(docs.map((d) => d.slug)).toContain('table:Orders');
    });
});

describe('нарезка форм Delphi', () => {
    const unit = [
        'unit ListSales;',
        'interface',
        'implementation',
        'procedure TfListSales.CalcKPI;',
        'begin',
        '  Query.SQL.Text := \'SELECT SUM(TotalPriceFact) FROM ItemsOrders\';',
        'end;',
        'procedure TfListSales.CalcDebt;',
        'begin',
        '  ShowDebt;',
        'end;',
    ].join('\n');

    it('процедура не разрывается посередине', () => {
        const chunks = chunkPascal(unit);
        const withKpi = chunks.find((c) => c.includes('CalcKPI'));
        expect(withKpi).toBeDefined();
        expect(withKpi).toContain('SELECT SUM(TotalPriceFact)');
        expect(withKpi).toContain('end;');
    });

    it('мелкие процедуры слипаются в один кусок, а не плодят записи', () => {
        expect(chunkPascal(unit).length).toBe(1);
    });

    it('длинная процедура режется, и куски получают разные slug', () => {
        const long = `procedure Big;\nbegin\n${'  X := X + 1;\n'.repeat(1200)}end;`;
        const docs = docsFromPascal('Big.pas', long, 'ЦехУспех исходник/Big.pas');
        expect(docs.length).toBeGreaterThan(1);
        expect(new Set(docs.map((d) => d.slug)).size).toBe(docs.length);
        // Источник у продолжений помечен, иначе Тамара сошлётся на файл целиком.
        expect(docs[1].sourceRef).toContain('часть 2');
    });

    it('файл без процедур не теряется', () => {
        const docs = docsFromPascal('Consts.pas', 'unit Consts;\nconst A = 1;', 'x/Consts.pas');
        expect(docs).toHaveLength(1);
        expect(docs[0].content).toContain('const A = 1');
    });
});

describe('структура из живой базы', () => {
    it('имя таблицы берётся в правильном регистре из дампа', async () => {
        const { docsFromColumns, properCaseMap } = await import('@/lib/shtab/tseh-code');
        // MySQL на сервере ЗМК отдаёт имена строчными, а зовётся таблица Orders.
        const docs = docsFromColumns(
            [{ table: 'orders', column: 'ID', type: 'int(11)', nullable: 'NO' }],
            'структура боевой базы zmk',
            properCaseMap(DUMP),
        );
        expect(docs[0].name).toBe('Orders');
        expect(docs[0].slug).toBe('table:Orders');
        expect(docs[0].content).toContain('ID — int(11), обязательное');
    });

    it('таблицы, которой нет в дампе, имя не выдумывается', async () => {
        const { docsFromColumns, properCaseMap } = await import('@/lib/shtab/tseh-code');
        const docs = docsFromColumns(
            [{ table: 'newtable', column: 'X', type: 'int' }],
            'структура боевой базы zmk',
            properCaseMap(DUMP),
        );
        expect(docs[0].name).toBe('newtable');
    });
});

describe('чистка перед базой', () => {
    it('нулевой байт не доезжает до Postgres', async () => {
        const { sanitize, docsFromPascal } = await import('@/lib/shtab/tseh-code');
        // Postgres отвечает на \u0000 в text ошибкой 22021 и роняет весь засев.
        expect(sanitize('a\u0000b')).toBe('ab');
        const docs = docsFromPascal('X.pas', 'procedure A;\u0000\nbegin\nend;', 'x/X.pas');
        expect(docs[0].content).not.toContain('\u0000');
    });

    it('перевод строки и табуляция остаются — это разметка кода', async () => {
        const { sanitize } = await import('@/lib/shtab/tseh-code');
        expect(sanitize('a\n\tb')).toBe('a\n\tb');
    });
});

describe('отпечаток', () => {
    it('меняется вместе с текстом', () => {
        expect(codeFingerprint('a')).toBe(codeFingerprint('a'));
        expect(codeFingerprint('a')).not.toBe(codeFingerprint('b'));
    });
});
