import { supabase } from '@/utils/supabase';
import { EXTERNAL_DB_TITLES, assertReadOnlyQuery, externalDbConfigured, externalEngine, queryExternal } from '@/lib/shtab/external/client';
import { FORBIDDEN_RELATIONS } from '@/lib/shtab/tamara-sql';
import { formatWeekReview, lastWeek, loadWeek, recommend } from '@/lib/sales-rop/load-review';
import { recentReports, sendToOwner } from '@/lib/shtab/tamara-telegram';

/**
 * Чем Тамара ориентируется в данных.
 *
 * Ей открыта вся база — сто сорок пять таблиц. Открыть доступ и не дать карты
 * оказалось хуже, чем не открывать: на вопрос «разбери работу отдела за сорок
 * дней» она потратила все четырнадцать разрешённых шагов на разведку, сделала
 * сорок запросов подряд и не ответила вовсе. Человек в такой ситуации сначала
 * смотрит, какие есть таблицы, а потом спрашивает по делу.
 *
 * Здесь три вещи, которых ей не хватало:
 *   — карта нашей базы: какие таблицы есть и из чего состоят;
 *   — произвольный запрос к базе завода (ЦехУспех), а не только семь готовых
 *     показателей: «покажи заказы, выпущенные сегодня» раньше было не спросить;
 *   — готовый разбор работы отдела продаж, который иначе собирается десятком
 *     запросов и каждый раз по-новому.
 */

type ToolResult = Record<string, unknown>;

export const DATA_TOOLS = [
    {
        type: 'function' as const,
        function: {
            name: 'db_schema',
            description:
                'Карта нашей базы: какие таблицы есть и какие в них колонки. Вызывай ПЕРЕД тем, как писать запрос к незнакомой таблице, — иначе уйдёшь в перебор и не успеешь ответить. Без имени таблицы вернёт список всех таблиц с числом строк; с именем — колонки и их типы.',
            parameters: {
                type: 'object',
                properties: {
                    table: { type: 'string', description: 'Имя таблицы — тогда вернутся её колонки.' },
                    like: { type: 'string', description: 'Кусок имени, чтобы найти нужные таблицы: salary, call, okk.' },
                },
            },
        },
    },
    {
        type: 'function' as const,
        function: {
            name: 'tseh_query',
            description:
                'Задать произвольный вопрос базе завода (ЦехУспех) запросом SELECT. Это MySQL, а не наша база: пиши под MySQL. Здесь производство — заказы в цехе, их движение и выпуск, техкарты, сотрудники завода. Готовые инструменты tseh_* отвечают только про деньги и клиентов; всё остальное спрашивай этим. Не знаешь таблиц — вызови tseh_tables.',
            parameters: {
                type: 'object',
                properties: {
                    sql: { type: 'string', description: 'Запрос SELECT под MySQL. Один оператор.' },
                    purpose: { type: 'string', description: 'Что проверяешь — попадёт в журнал.' },
                },
                required: ['sql'],
            },
        },
    },
    {
        type: 'function' as const,
        function: {
            name: 'tseh_tables',
            description:
                'Какие таблицы есть в базе завода (ЦехУспех) и какие в них колонки. Вызывай перед tseh_query: имена там свои, наугад не составить.',
            parameters: {
                type: 'object',
                properties: {
                    table: { type: 'string', description: 'Имя таблицы — тогда вернутся её колонки.' },
                    like: { type: 'string', description: 'Кусок имени для поиска нужной таблицы.' },
                },
            },
        },
    },
    {
        type: 'function' as const,
        function: {
            name: 'sales_team_review',
            description:
                'Готовый разбор работы отдела продаж за период: по каждому человеку сколько задач выдано, сколько отработано, по скольким был подтверждённый разговор, ответил ли клиент, сдвинулся ли заказ, сколько закрыто одним комментарием, — и рекомендация по личной нагрузке с обоснованием. Вызывай на любой вопрос «как работают девочки», «кому поднять нагрузку», «кто сливает задачи»: иначе это десяток запросов и каждый раз разный ответ. Отпуска учитываются: отсутствовавшего с работавшими не сравниваем.',
            parameters: {
                type: 'object',
                properties: {
                    from: { type: 'string', description: 'Начало периода ГГГГ-ММ-ДД. По умолчанию прошлая неделя.' },
                    to: { type: 'string', description: 'Конец периода ГГГГ-ММ-ДД.' },
                    days: { type: 'integer', description: 'Или просто: за сколько последних дней.' },
                },
            },
        },
    },
    {
        type: 'function' as const,
        function: {
            name: 'telegram_owner',
            description:
                'Написать владельцу в телеграм. Адресат один и задан в настройках — чужой чат указать нельзя. Подпись добавляется сама, её писать не надо. Пользуйся, когда владелец просит что-то прислать или когда собираешь для него отчёт. Каждое сообщение остаётся в журнале отправок.',
            parameters: {
                type: 'object',
                properties: {
                    text: { type: 'string', description: 'Текст сообщения. Простой текст, без разметки.' },
                    kind: {
                        type: 'string',
                        description: 'Что это: message — обычное сообщение, daily_report — ежедневный отчёт.',
                    },
                },
                required: ['text'],
            },
        },
    },
    {
        type: 'function' as const,
        function: {
            name: 'my_reports',
            description:
                'Мои прошлые отчёты владельцу. Вызывай перед тем, как собрать новый: форму отчёта выбираю я, и она не должна меняться каждый день без причины — к отчёту привыкают и читают его по привычным местам.',
            parameters: {
                type: 'object',
                properties: { limit: { type: 'integer', description: 'Сколько последних. По умолчанию 3.' } },
            },
        },
    },
] as const;

export const DATA_TOOL_NAMES: ReadonlySet<string> = new Set<string>(DATA_TOOLS.map((t) => t.function.name));

/** Таблицы, закрытые для чтения, прячем и из карты: их нет смысла даже называть. */
const HIDDEN = new Set<string>(FORBIDDEN_RELATIONS as readonly string[]);

async function ourSchema(args: any): Promise<ToolResult> {
    const table = args?.table ? String(args.table) : null;

    if (table) {
        if (HIDDEN.has(table)) return { available: false, reason: `Таблица «${table}» закрыта.` };
        const { data, error } = await supabase.rpc('shtab_run_readonly_query', {
            p_sql:
                `SELECT column_name, data_type FROM information_schema.columns ` +
                `WHERE table_schema = 'public' AND table_name = '${table.replace(/'/g, '')}' ` +
                `ORDER BY ordinal_position LIMIT 200`,
        });
        if (error) return { available: false, reason: error.message };
        const rows = (data ?? []) as any[];
        if (rows.length === 0) return { available: false, reason: `Таблицы «${table}» нет.` };
        return { table, columns: rows };
    }

    const like = args?.like ? String(args.like).replace(/'/g, '') : null;
    const filter = like ? ` AND table_name LIKE '%${like}%'` : '';
    const { data, error } = await supabase.rpc('shtab_run_readonly_query', {
        p_sql:
            `SELECT table_name FROM information_schema.tables ` +
            `WHERE table_schema = 'public' AND table_type IN ('BASE TABLE','VIEW')${filter} ` +
            `ORDER BY table_name LIMIT 300`,
    });
    if (error) return { available: false, reason: error.message };

    const names = ((data ?? []) as any[]).map((r) => String(r.table_name)).filter((n) => !HIDDEN.has(n));
    return {
        tables: names,
        count: names.length,
        note:
            'Колонки смотри вызовом с именем таблицы. Закрыты только пароли и ключи входа. ' +
            'Связь звонка с заказом — call_order_link (привязка из RetailCRM; call_order_matches это наш матчинг, он ошибается примерно в трети случаев).',
    };
}

async function tsehSchema(args: any): Promise<ToolResult> {
    if (!externalDbConfigured('tseh')) {
        return { available: false, reason: `База «${EXTERNAL_DB_TITLES.tseh}» не подключена.` };
    }
    const table = args?.table ? String(args.table).replace(/[^\w]/g, '') : null;

    try {
        if (table) {
            const rows = await queryExternal('tseh', `SHOW COLUMNS FROM \`${table}\``, []);
            return { table, columns: rows };
        }
        const like = args?.like ? String(args.like).replace(/[^\w]/g, '') : null;
        const rows = await queryExternal('tseh', like ? `SHOW TABLES LIKE '%${like}%'` : 'SHOW TABLES', []);
        return {
            tables: rows,
            note: 'Колонки смотри вызовом с именем таблицы. Это MySQL: запросы пиши под неё.',
        };
    } catch (e: any) {
        return { available: false, reason: String(e?.message ?? e) };
    }
}

/** Сколько строк отдаём модели: больше она всё равно не удержит, а контекст не резиновый. */
const TSEH_MAX_ROWS = 100;

async function tsehQuery(args: any): Promise<ToolResult> {
    const sql = String(args?.sql ?? '').trim();
    if (!sql) return { available: false, reason: 'Пустой запрос.' };
    if (!externalDbConfigured('tseh')) {
        return { available: false, reason: `База «${EXTERNAL_DB_TITLES.tseh}» не подключена.` };
    }

    try {
        // Проверка «только чтение» — та же, что стоит перед остальными внешними
        // базами: один оператор, только SELECT. Завод работает на этой базе, и
        // запись туда из разговора недопустима ни при каких условиях.
        assertReadOnlyQuery(sql, externalEngine('tseh'));
        const body = sql.replace(/;\s*$/, '');
        const limited = /\blimit\s+\d+/i.test(body) ? body : `${body} LIMIT ${TSEH_MAX_ROWS}`;
        const rows = await queryExternal('tseh', limited, []);
        return {
            rows,
            row_count: Array.isArray(rows) ? rows.length : 0,
            sql: limited,
            note: 'База завода, только чтение. Если строк ровно сто — ответ обрезан, уточни запрос.',
        };
    } catch (e: any) {
        // Ошибку возвращаем текстом: модель должна прочитать её и переписать
        // запрос, а не уронить разговор.
        return { available: false, reason: String(e?.message ?? e) };
    }
}

async function teamReview(args: any): Promise<ToolResult> {
    const today = new Date().toISOString().slice(0, 10);
    let from = args?.from ? String(args.from) : null;
    let to = args?.to ? String(args.to) : null;

    if (!from || !to) {
        const days = Number(args?.days);
        if (Number.isFinite(days) && days > 0) {
            const end = new Date();
            const start = new Date(end.getTime() - days * 86_400_000);
            from = start.toISOString().slice(0, 10);
            to = end.toISOString().slice(0, 10);
        } else {
            const week = lastWeek(today);
            from = week.from;
            to = week.to;
        }
    }

    const weeks = await loadWeek(from, to);
    if (weeks.length === 0) {
        return { available: false, reason: `За ${from} — ${to} задач в плане не было.` };
    }

    return {
        period: { from, to },
        managers: weeks.map((m) => {
            const rec = recommend(m);
            return {
                name: m.name,
                absent_part_of_period: m.absent,
                work_days: m.workDays,
                tasks_issued: m.tasksIssued,
                tasks_touched: m.tasksTouched,
                tasks_comment_only: m.tasksCommentOnly,
                tasks_confirmed_contact: m.tasksConfirmed,
                tasks_client_replied: m.tasksReplied,
                tasks_order_moved: m.tasksMoved,
                orders_to_production: m.productionCount,
                production_amount: m.productionAmount,
                calls: m.calls,
                call_minutes: m.callMinutes,
                personal_load_factor: m.personalFactor,
                recommendation: rec.action,
                recommendation_title: rec.title,
                recommendation_reason: rec.reason,
                suggested_factor: rec.suggestedFactor,
            };
        }),
        text: formatWeekReview(from, to, weeks),
        note:
            'Работой считается внешний след: разговор, письмо, ответ клиента, движение заказа. ' +
            'Задача, закрытая одним комментарием, отработкой не считается — по ней менеджер написал о себе сам. ' +
            'Нагрузку не меняй: предложи её изменение через settings_propose, применяет владелец.',
    };
}

export async function executeDataTool(name: string, args: any): Promise<ToolResult> {
    try {
        if (name === 'db_schema') return await ourSchema(args);
        if (name === 'tseh_tables') return await tsehSchema(args);
        if (name === 'tseh_query') return await tsehQuery(args);
        if (name === 'sales_team_review') return await teamReview(args);

        if (name === 'telegram_owner') {
            const text = String(args?.text ?? '').trim();
            if (!text) return { ok: false, reason: 'Пустое сообщение отправлять не буду.' };
            const kind = String(args?.kind ?? 'message');
            const res = await sendToOwner(text, {
                kind,
                reportDate: kind === 'daily_report' ? new Date().toISOString().slice(0, 10) : null,
            });
            return res.ok
                ? { ok: true, sent: true, parts: res.parts, note: 'Отправлено владельцу, подпись поставлена.' }
                : { ok: false, reason: res.error ?? 'не отправилось' };
        }

        if (name === 'my_reports') {
            const items = await recentReports(Number(args?.limit) || 3);
            return items.length === 0
                ? { reports: [], note: 'Отчётов ещё не было — форму выбираешь ты.' }
                : { reports: items, note: 'Держись знакомой формы: к отчёту привыкают.' };
        }
        return { available: false, reason: `Неизвестный инструмент: ${name}` };
    } catch (e: any) {
        return { available: false, reason: String(e?.message ?? e) };
    }
}
