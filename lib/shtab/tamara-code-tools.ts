import { getCodeSnapshot, listCodeFiles, readCodeFile, searchCode } from '@/lib/project-code';

/**
 * Исходный код проекта глазами Тамары.
 *
 * Компания работает так, как написано в этом коде: по какому правилу бот считает
 * нагрузку, что попадает в план дня, откуда берётся строка в отчёте. Пока кода
 * она не видела, на вопрос «почему так» оставалось либо промолчать, либо
 * объяснить правдоподобно и неверно — а второе хуже.
 *
 * Только чтение снимка: писать в код через разговор нельзя, и снимок обновляется
 * отдельным скриптом при выкладке. Поэтому каждый ответ по коду обязан нести
 * коммит и дату снимка — иначе «в коде написано» не перепроверить.
 */

type ToolResult = Record<string, unknown>;

export const CODE_TOOLS = [
    {
        type: 'function' as const,
        function: {
            name: 'code_search',
            description:
                'Найти в исходном коде сервиса место, где что-то происходит. Ищет буквально по подстроке, как grep: имя настройки (load_factor), таблицу (sales_rop_settings), функцию (loadSettings), кусок текста из интерфейса. Вызывай, когда нужно понять, КАК устроена работа: что именно считает бот, откуда берётся число в отчёте, почему настройка влияет так, а не иначе.',
            parameters: {
                type: 'object',
                properties: {
                    query: { type: 'string', description: 'Что искать буквально. Короткая точная строка работает лучше фразы.' },
                    path_like: { type: 'string', description: 'Сузить по пути: lib/salary, app/api/sales-rop, migrations.' },
                    limit: { type: 'integer', description: 'Сколько файлов вернуть, по умолчанию 8.' },
                },
                required: ['query'],
            },
        },
    },
    {
        type: 'function' as const,
        function: {
            name: 'code_read',
            description:
                'Прочитать файл исходного кода по пути — целиком или кусок. Сначала найди файл через code_search или code_files: пути наизусть не угадываются.',
            parameters: {
                type: 'object',
                properties: {
                    path: { type: 'string', description: 'Путь от корня: lib/sales-rop/service.ts.' },
                    from_line: { type: 'integer', description: 'С какой строки. По умолчанию с первой.' },
                    lines: { type: 'integer', description: 'Сколько строк, максимум 400.' },
                },
                required: ['path'],
            },
        },
    },
    {
        type: 'function' as const,
        function: {
            name: 'code_files',
            description:
                'Список файлов проекта по куску пути — чтобы понять, где что лежит. Подсистемы разложены так: lib/<подсистема> — логика, app/api/<подсистема> — обращения из интерфейса, app/<раздел> — сами экраны, migrations — таблицы, docs — описания как устроено.',
            parameters: {
                type: 'object',
                properties: {
                    path_like: { type: 'string', description: 'Кусок пути: salary, sales-rop, okk.' },
                },
                required: ['path_like'],
            },
        },
    },
] as const;

export const CODE_TOOL_NAMES: ReadonlySet<string> = new Set<string>(CODE_TOOLS.map((t) => t.function.name));

function snapshotNote(snapshot: Awaited<ReturnType<typeof getCodeSnapshot>>): Record<string, unknown> {
    if (!snapshot) {
        return {
            snapshot: null,
            warning: 'Снимок кода не залит — отвечать по коду нечем. Так и скажи владельцу.',
        };
    }
    return {
        snapshot: {
            commit: snapshot.commit_sha.slice(0, 8),
            branch: snapshot.branch,
            taken_at: snapshot.taken_at,
            files: snapshot.files,
        },
        note: 'Ссылаясь на код, называй файл и дату снимка: код мог измениться после того, как снимок сняли.',
    };
}

export async function executeCodeTool(name: string, args: any): Promise<ToolResult> {
    try {
        if (name === 'code_search') {
            const { hits, total, snapshot } = await searchCode({
                query: String(args?.query ?? ''),
                pathLike: args?.path_like ? String(args.path_like) : undefined,
                limit: Number(args?.limit) || undefined,
            });
            if (hits.length === 0) {
                return {
                    found: 0,
                    ...snapshotNote(snapshot),
                    hint: 'Ничего не нашлось. Попробуй короче и точнее: имя ключа, таблицы или функции, без окончаний и кавычек.',
                };
            }
            return {
                found: total,
                files: hits.map((h) => ({ path: h.path, matches: h.matches, lines: h.lines, excerpt: h.excerpt })),
                ...snapshotNote(snapshot),
            };
        }

        if (name === 'code_read') {
            const res = await readCodeFile(String(args?.path ?? ''), {
                from: Number(args?.from_line) || undefined,
                lines: Number(args?.lines) || undefined,
            });
            return {
                path: res.path,
                shown: `строки ${res.from}–${res.to} из ${res.total}`,
                text: res.text,
                ...snapshotNote(res.snapshot),
            };
        }

        if (name === 'code_files') {
            const files = await listCodeFiles(String(args?.path_like ?? ''));
            return { count: files.length, files, ...snapshotNote(await getCodeSnapshot()) };
        }

        return { available: false, reason: `Неизвестный инструмент кода: ${name}` };
    } catch (e: any) {
        return { available: false, reason: String(e?.message ?? e) };
    }
}
