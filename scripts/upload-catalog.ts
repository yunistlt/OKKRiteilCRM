/**
 * Положить каталог продукции на постоянную ссылку `/katalog`.
 *
 * Каталог хранится как файл нашего юрлица (папка «Каталог продукции», с
 * галочкой «публичный») — тем же механизмом, что устав и выписка. Отдельного
 * хранилища нет намеренно: заменить файл можно и вкладкой «Файлы» в карточке
 * юрлица, этот скрипт — для первой загрузки.
 *
 * Запуск: npx tsx scripts/upload-catalog.ts --file="/путь/Каталог 2026.pdf" [--slug=zmk]
 */
import { readFileSync } from 'fs';
import { basename } from 'path';
import { config } from 'dotenv';

config({ path: '.env.local' });

const arg = (name: string): string | null =>
    process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=').slice(1).join('=') ?? null;

async function main() {
    const file = arg('file');
    const slug = arg('slug') || 'zmk';
    if (!file) {
        console.error('Нужно --file="/путь/к/каталогу.pdf"');
        process.exit(1);
    }

    const { entityBySlug, putEntityFile } = await import('../lib/legal-entity/files');
    const { CATALOG_FOLDER } = await import('../lib/catalog');

    const entity = await entityBySlug(slug);
    if (!entity) {
        console.error(`Юрлицо «${slug}» не найдено`);
        process.exit(1);
    }

    const bytes = readFileSync(file);
    const name = basename(file);

    const result = await putEntityFile({
        entityId: entity.id,
        slug,
        fileName: name,
        folder: CATALOG_FOLDER,
        contentType: name.toLowerCase().endsWith('.pdf') ? 'application/pdf' : 'application/octet-stream',
        bytes,
        source: 'загрузка каталога (скрипт)',
        isPublic: true,
    });

    if (!result.ok) {
        console.error(`Не загрузился: ${result.reason}`);
        process.exit(1);
    }

    const { catalogFile } = await import('../lib/catalog');
    const current = await catalogFile();
    console.log(`загружен «${name}» (${(bytes.byteLength / 1048576).toFixed(1)} МБ) для ${entity.name}`);
    console.log(`по ссылке /katalog сейчас отдаётся: ${current?.fileName ?? '—'}`);
}

main();
