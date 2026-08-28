/**
 * Кладёт логику ЦехУспеха в РАГ-базу Тамары.
 *
 *   npm run shtab:index-tseh-code            — засев/обновление
 *   npm run shtab:index-tseh-code -- --dry   — только посчитать, ничего не писать
 *
 * Источники (обе только на чтение, ни одной записи в папку ЦехУспеха):
 *   ~/ZehUspeh AI/gb_zmk_схема.sql   — тела функций и структура таблиц
 *   ~/ZehUspeh AI/ЦехУспех исходник  — формы Delphi (*.pas)
 *
 * Путь к папке задаётся TSEH_SOURCE_DIR, по умолчанию — «/Users/andreiterenkov/ZehUspeh AI».
 * Повторный запуск дёшев: пересчитываются только изменившиеся куски.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { config } from 'dotenv';
import postgres from 'postgres';
import { generateEmbedding } from '@/lib/embeddings';
import { closeExternal, externalDbConfigured, queryExternal } from '@/lib/shtab/external/client';
import { docsFromColumns, docsFromDump, docsFromPascal, indexTsehCode } from '@/lib/shtab/tseh-code';
import type { TsehCodeDoc } from '@/lib/shtab/tseh-code';

config({ path: '.env.local' });

const ROOT = process.env.TSEH_SOURCE_DIR || '/Users/andreiterenkov/ZehUspeh AI';
const DUMP = path.join(ROOT, 'gb_zmk_схема.sql');
const SOURCES = path.join(ROOT, 'ЦехУспех исходник');
const DRY = process.argv.includes('--dry');

function pasFiles(dir: string): string[] {
    const out: string[] = [];
    for (const entry of readdirSync(dir)) {
        const full = path.join(dir, entry);
        if (statSync(full).isDirectory()) out.push(...pasFiles(full));
        else if (/\.pas$/i.test(entry)) out.push(full);
    }
    return out;
}

async function main() {
    const docs: TsehCodeDoc[] = [];

    const dump = readFileSync(DUMP, 'utf8');
    const fromDump = docsFromDump(dump, path.basename(DUMP));
    // Из дампа берутся только функции: их тела read-only учётке не видны.
    // Структура таблиц — из живой базы, дамп по ней уже отстал.
    const functions = fromDump.filter((d) => d.kind === 'function');
    docs.push(...functions);
    console.log(`Дамп: ${functions.length} функций`);

    if (externalDbConfigured('tseh')) {
        const rows = await queryExternal<any>(
            'tseh',
            "SELECT TABLE_NAME `table`, COLUMN_NAME `column`, COLUMN_TYPE `type`, IS_NULLABLE nullable " +
                'FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() ORDER BY TABLE_NAME, ORDINAL_POSITION',
        );
        const tables = docsFromColumns(rows, 'структура боевой базы zmk');
        docs.push(...tables);
        console.log(`База: ${tables.length} таблиц`);
        await closeExternal();
    } else {
        const tables = fromDump.filter((d) => d.kind === 'table');
        docs.push(...tables);
        console.log(`База недоступна, структура из дампа: ${tables.length} таблиц (в базе их больше)`);
    }

    const files = pasFiles(SOURCES);
    for (const file of files) {
        // Delphi пишет в cp1251, и это не мелочь: в utf8 комментарии и подписи
        // станут мусором, а по мусору Тамара ничего не найдёт.
        const source = new TextDecoder('windows-1251').decode(readFileSync(file));
        docs.push(...docsFromPascal(path.basename(file), source, path.relative(ROOT, file)));
    }
    console.log(`Формы: ${files.length} файлов → ${docs.filter((d) => d.kind === 'unit').length} кусков`);
    console.log(`Всего записей: ${docs.length}`);

    if (DRY) {
        console.log('--dry: в базу ничего не пишу.');
        return;
    }

    const url = process.env.POSTGRES_URL || process.env.DATABASE_URL;
    if (!url) throw new Error('Нет DATABASE_URL/POSTGRES_URL');
    const sql = postgres(url, { max: 1 });

    try {
        const report = await indexTsehCode(sql, docs, generateEmbedding, (m) => console.log(m));
        console.log(
            `Готово: добавлено ${report.inserted}, обновлено ${report.updated}, ` +
                `без изменений ${report.unchanged}, погашено ${report.deactivated}`,
        );
    } finally {
        await sql.end();
    }
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
