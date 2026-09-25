/**
 * Залить снимок исходного кода в базу, чтобы Тамара могла в него смотреть.
 *
 *   npm run tamara:index-code            — залить текущий код
 *   npx tsx scripts/index-project-code.ts --dry    — посчитать, но не писать
 *
 * Запускается сам после сборки на Vercel (см. `build` в package.json), поэтому
 * снимок обновляется ровно тем кодом, который в эту минуту выкладывается. До
 * этого его надо было перезаливать руками, а забытый снимок — это ответ по
 * коду, которого в проде уже нет.
 *
 * Два правила, без которых автомат приносит вреда больше, чем пользы:
 *
 *   1. Пишем только с боевой выкладки. Предварительные сборки (preview) идут с
 *      веток и с чужими правками; дай им писать — и Тамара будет отвечать по
 *      коду, которого в проде нет и, может быть, не будет никогда.
 *   2. Не роняем сборку. Выкладка важнее снимка: провал печатается заметно, а
 *      устаревание и так видно — Тамара называет дату снимка в каждом ответе
 *      по коду.
 */
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import postgres from 'postgres';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

/** Что считаем кодом проекта. Картинки и бинарники смысла не несут. */
const EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.sql', '.md', '.json', '.css'];

/**
 * Что в снимок не попадает: сборка, зависимости, lock-файлы, фикстуры и
 * черновики. Это мегабайты, в которых нечего понимать.
 */
const SKIP_DIRS = ['node_modules', '.next', '.git', '.vercel', 'golds', 'scratch', 'coverage', '.claude'];
const SKIP_FILES = ['package-lock.json'];

const MAX_FILE_BYTES = 400_000;

/**
 * Список файлов.
 *
 * Сначала git — он единственный знает, что под контролем версий, а что мусор
 * рядом. На Vercel гита в сборке может не быть, поэтому есть обход каталога с
 * теми же исключениями.
 */
function projectFiles(): { files: string[]; source: 'git' | 'fs' } {
    try {
        const out = execSync('git ls-files', { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] });
        const files = out.split('\n').map((s) => s.trim()).filter(Boolean).filter(keep);
        if (files.length > 0) return { files, source: 'git' };
    } catch {
        // гита в окружении сборки нет — идём по файловой системе
    }

    const files: string[] = [];
    const walk = (dir: string) => {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            if (entry.isDirectory()) {
                if (SKIP_DIRS.includes(entry.name)) continue;
                walk(path.join(dir, entry.name));
            } else {
                const rel = path.relative('.', path.join(dir, entry.name));
                if (keep(rel)) files.push(rel);
            }
        }
    };
    walk('.');
    return { files: files.sort(), source: 'fs' };
}

function keep(rel: string): boolean {
    if (!EXTENSIONS.includes(path.extname(rel))) return false;
    if (SKIP_FILES.includes(path.basename(rel))) return false;
    const parts = rel.split('/');
    return !parts.some((p) => SKIP_DIRS.includes(p));
}

/** Коммит: на Vercel его даёт окружение, локально — git. */
function currentCommit(): { commit: string; branch: string } {
    const envCommit = process.env.VERCEL_GIT_COMMIT_SHA;
    const envBranch = process.env.VERCEL_GIT_COMMIT_REF;
    if (envCommit) return { commit: envCommit, branch: envBranch || 'unknown' };
    try {
        return {
            commit: execSync('git rev-parse HEAD', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(),
            branch: execSync('git rev-parse --abbrev-ref HEAD', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(),
        };
    } catch {
        return { commit: 'unknown', branch: 'unknown' };
    }
}

async function main() {
    const dry = process.argv.includes('--dry');
    // Автоматический заход на Vercel: тихо уходим, если это не боевая выкладка.
    const auto = process.argv.includes('--if-production');
    if (auto && process.env.VERCEL_ENV !== 'production') {
        console.log(`[снимок кода] пропускаю: окружение ${process.env.VERCEL_ENV || 'не Vercel'}, пишем только с боевой выкладки`);
        return;
    }

    const databaseUrl = process.env.DATABASE_URL || process.env.POSTGRES_URL;
    if (!databaseUrl) {
        if (auto) {
            console.warn('[снимок кода] нет DATABASE_URL — снимок не обновлён, Тамара останется на прежнем');
            return;
        }
        throw new Error('Нет DATABASE_URL в .env.local');
    }

    const { commit, branch } = currentCommit();
    const { files, source } = projectFiles();

    const rows: Array<{ path: string; content: string; lines: number; bytes: number; lang: string }> = [];
    let skippedBig = 0;

    for (const file of files) {
        let buf: Buffer;
        try {
            buf = fs.readFileSync(file);
        } catch {
            continue; // файл исчез между списком и чтением — не повод падать
        }
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
        `[снимок кода] коммит ${commit.slice(0, 8)} (${branch}, список по ${source}): файлов ${rows.length}, ` +
            `${(totalBytes / 1024 / 1024).toFixed(1)} МБ` +
            (skippedBig ? `, пропущено крупных: ${skippedBig}` : ''),
    );
    if (dry) return;

    // Пустой список — почти наверняка сломанный обход, а не пустой проект.
    // Стереть снимок и записать ничего было бы хуже, чем не трогать его.
    if (rows.length === 0) {
        console.warn('[снимок кода] файлов не нашлось — прежний снимок оставляю как есть');
        return;
    }

    const sql = postgres(databaseUrl, { ssl: 'require' });
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
        console.log('[снимок кода] обновлён.');
    } finally {
        await sql.end();
    }
}

main().catch((e) => {
    // На выкладке снимок — не повод не выложиться: печатаем заметно и выходим
    // с нулём. Запуск руками должен падать честно.
    if (process.argv.includes('--if-production')) {
        console.warn(`[снимок кода] НЕ ОБНОВЛЁН: ${e.message}. Тамара продолжит отвечать по прежнему снимку и назовёт его дату.`);
        return;
    }
    console.error(e);
    process.exit(1);
});
