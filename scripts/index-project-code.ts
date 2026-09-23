/**
 * Залить снимок исходного кода в базу, чтобы Тамара могла в него смотреть.
 *
 *   npx tsx scripts/index-project-code.ts          — залить текущий HEAD
 *   npx tsx scripts/index-project-code.ts --dry    — посчитать, но не писать
 *
 * Берём ровно то, что под контролем версий (git ls-files): рабочая копия
 * содержит .next, node_modules и черновики, и попади они в снимок, Тамара
 * отвечала бы по сборке полугодовой давности как по коду.
 *
 * Снимок не инкрементальный: файлы переименовывают и удаляют, а удалённый файл,
 * оставшийся в индексе, — это ответ про код, которого больше нет. Дешевле
 * перезалить 8 МБ, чем однажды получить такой ответ.
 */
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import postgres from 'postgres';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

const DATABASE_URL = process.env.DATABASE_URL || process.env.POSTGRES_URL;
if (!DATABASE_URL) {
    console.error('Нет DATABASE_URL в .env.local');
    process.exit(1);
}

/** Что считаем кодом проекта. Картинки и бинарники смысла не несут. */
const EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.sql', '.md', '.json', '.css'];

/**
 * Что в снимок не попадает.
 *
 * `.env` тут нет намеренно — он и так не под контролем версий. А вот lock-файлы
 * и данные фикстур под ним есть: это мегабайты, в которых нечего понимать.
 */
const SKIP = [
    'package-lock.json',
    'node_modules/',
    '.next/',
    'golds/',
    'tests/fixtures/',
    'scratch/',
];

const MAX_FILE_BYTES = 400_000;

function gitFiles(): string[] {
    const out = execSync('git ls-files', { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    return out
        .split('\n')
        .map((s) => s.trim())
        .filter(Boolean)
        .filter((p) => EXTENSIONS.includes(path.extname(p)))
        .filter((p) => !SKIP.some((s) => p.startsWith(s) || p.includes(`/${s}`)));
}

async function main() {
    const dry = process.argv.includes('--dry');
    const commit = execSync('git rev-parse HEAD', { encoding: 'utf8' }).trim();
    const branch = execSync('git rev-parse --abbrev-ref HEAD', { encoding: 'utf8' }).trim();

    const files = gitFiles();
    const rows: Array<{ path: string; content: string; lines: number; bytes: number; lang: string }> = [];
    let skippedBig = 0;

    for (const file of files) {
        const buf = fs.readFileSync(file);
        if (buf.byteLength > MAX_FILE_BYTES) {
            skippedBig++;
            continue;
        }
        // Файл с нулевым байтом — не текст, как бы ни выглядело расширение.
        if (buf.includes(0)) continue;
        const content = buf.toString('utf8');
        rows.push({
            path: file,
            content,
            lines: content.split('\n').length,
            bytes: buf.byteLength,
            lang: path.extname(file).replace('.', ''),
        });
    }

    const totalBytes = rows.reduce((s, r) => s + r.bytes, 0);
    console.log(
        `Коммит ${commit.slice(0, 8)} (${branch}): файлов ${rows.length}, ${(totalBytes / 1024 / 1024).toFixed(1)} МБ` +
            (skippedBig ? `, пропущено крупных: ${skippedBig}` : ''),
    );
    if (dry) return;

    const sql = postgres(DATABASE_URL!, { ssl: 'require' });
    try {
        // Меняем снимок одной транзакцией: без неё есть окно, в котором Тамара
        // видит наполовину удалённый проект и отвечает по нему.
        await sql.begin(async (tx) => {
            await tx`DELETE FROM project_code_file`;
            const CHUNK = 50;
            for (let i = 0; i < rows.length; i += CHUNK) {
                const chunk = rows.slice(i, i + CHUNK).map((r) => ({ ...r, commit_sha: commit }));
                await tx`INSERT INTO project_code_file ${tx(chunk, 'path', 'content', 'lines', 'bytes', 'lang', 'commit_sha')}`;
            }
            await tx`
                INSERT INTO project_code_snapshot (id, commit_sha, branch, files, taken_at)
                VALUES (true, ${commit}, ${branch}, ${rows.length}, now())
                ON CONFLICT (id) DO UPDATE
                SET commit_sha = EXCLUDED.commit_sha,
                    branch = EXCLUDED.branch,
                    files = EXCLUDED.files,
                    taken_at = EXCLUDED.taken_at
            `;
        });
        console.log('Снимок кода обновлён.');
    } finally {
        await sql.end();
    }
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
