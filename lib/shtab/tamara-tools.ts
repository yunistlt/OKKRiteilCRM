import { supabase } from '@/utils/supabase';
import { formatStructure, loadStructure } from '@/lib/shtab/structure';
import { applyStructureOps } from '@/lib/shtab/structure-apply';
import type { StructureOp } from '@/lib/shtab/structure-apply';
import { importStaffDoc } from '@/lib/shtab/staff-doc-import';
import { tsehPeople, tsehStaffDocs } from '@/lib/shtab/tseh-staff';
import { catalogOverview, catalogSearch, lvzCalcSummary, lvzRead, lvzTables } from '@/lib/shtab/lvz';
import { applyRazborOps } from '@/lib/shtab/razbor-write';
import type { RazborOp } from '@/lib/shtab/razbor-write';
import { NON_INCOME_STATUSES, monthlyIncome, monthsAgo } from '@/lib/shtab/income';
import type { IncomeRow } from '@/lib/shtab/income';
import { topArea } from '@/lib/shtab/types';
import type { ShtabArea, ShtabMinus } from '@/lib/shtab/types';
import { verdict } from '@/lib/shtab/xmr';
import { TSEH_TOOLS, TSEH_TOOL_NAMES, executeTsehTool } from '@/lib/shtab/tseh-tools';
import { SETTINGS_TOOLS, SETTINGS_TOOL_NAMES, executeSettingsTool } from '@/lib/shtab/tamara-settings-tools';
import { CODE_TOOLS, CODE_TOOL_NAMES, executeCodeTool } from '@/lib/shtab/tamara-code-tools';
import { DATA_TOOLS, DATA_TOOL_NAMES, executeDataTool } from '@/lib/shtab/tamara-data-tools';
import { CORE_RELATIONS, runTamaraQuery } from '@/lib/shtab/tamara-sql';

/** Из какого разговора пришёл вызов — предложение по настройке помнит, откуда оно. */
export type ToolContext = { conversationId?: number | null };

// Инструменты Тамары (OpenAI function calling).
//
// Через них — и только через них — Тамара узнаёт что-либо о компании.
//
// Готовые инструменты отвечают на частые вопросы одинаково и проверяемо: у них
// фиксированный запрос, который можно прочитать и покрыть тестом. Их набор
// начинался как весь доступ Тамары к данным и оказался слишком тесным —
// управленческий вопрос почти никогда не совпадает с заранее написанным
// запросом.
//
// Поэтому рядом стоит shtab_query: произвольный SELECT по всей базе, закрыты
// только пароли и ключи входа (см. lib/shtab/tamara-sql.ts). Готовые
// инструменты от этого не стали лишними — они быстрее, и их ответы не зависят
// от того, как модель сегодня написала запрос.
//
// Пишущих инструментов три, и каждый пишет только в своё: структуру постов,
// открытый разбор и предложения по настройкам, которые применяет человек.

type ToolResult = Record<string, unknown>;

const MAX_ROWS = 200;

const OWN_TOOLS = [
    {
        type: 'function' as const,
        function: {
            name: 'shtab_state',
            description:
                'Текущее состояние Штаба: открытые минусы по областям, приоритетная область, разборы, проекты, посты, долгосрочные цели. Вызывай первым, когда вопрос о положении дел в компании.',
            parameters: {
                type: 'object',
                properties: {
                    include: {
                        type: 'array',
                        items: { type: 'string', enum: ['minuses', 'razbory', 'projects', 'posts', 'goals'] },
                        description: 'Какие части вернуть. По умолчанию минусы и приоритет.',
                    },
                },
            },
        },
    },
    {
        type: 'function' as const,
        function: {
            name: 'shtab_history',
            description:
                'Что закрыто за период: какие минусы закрыты, какими разборами и стратегиями, какие проекты сделаны, а какие просрочены. Отвечает на «что изменилось» и «что мы вообще довели до конца».',
            parameters: {
                type: 'object',
                properties: {
                    days: { type: 'integer', description: 'За сколько последних дней. По умолчанию 30.' },
                },
            },
        },
    },
    {
        type: 'function' as const,
        function: {
            name: 'money_in',
            description:
                'Приход группы по месяцам из выписок Точки и Т-Банка, в рублях, плюс вердикт контрольной карты (сигнал или обычное колебание). ВАЖНО: это приход, а не прибыль и не денежный поток — расходов в данных нет.',
            parameters: {
                type: 'object',
                properties: {
                    months: { type: 'integer', description: 'Сколько последних месяцев. По умолчанию 24.' },
                },
            },
        },
    },
    {
        type: 'function' as const,
        function: {
            name: 'shtab_razbor_detail',
            description:
                'Один разбор целиком: ситуация, «почему», обе части краткосрочной цели, карта ресурсов и полный текст стратегии. Вызывай перед тем, как резать стратегию на блоки или писать программу: shtab_state отдаёт разборы усечённо, по обрезку программу не написать.',
            parameters: {
                type: 'object',
                properties: {
                    razbor_id: { type: 'integer', description: 'Идентификатор разбора из shtab_state.' },
                },
                required: ['razbor_id'],
            },
        },
    },
    {
        type: 'function' as const,
        function: {
            name: 'shtab_programs',
            description:
                'Написанные программы: главная задача, руководитель, производственные задачи с целью и фактом. Отвечает на «где мы отстаём по программам» и нужен, чтобы не писать заново то, что уже написано.',
            parameters: {
                type: 'object',
                properties: {
                    razbor_id: { type: 'integer', description: 'Только программы этого разбора. По умолчанию все.' },
                },
            },
        },
    },
    {
        type: 'function' as const,
        function: {
            name: 'sales_facts',
            description:
                'ПРОДАЖИ отдела по месяцам: сколько заказов ушло в производство и на какую сумму, средний чек, сколько выставлено счетов. Это то, по чему меряется план отдела продаж. Не путать с tseh_* — там завод и его выручка. Вызывай первым на любой вопрос про план продаж и выполнение.',
            parameters: {
                type: 'object',
                properties: {
                    months: { type: 'integer', description: 'Сколько последних месяцев. По умолчанию 12.' },
                },
            },
        },
    },
    {
        type: 'function' as const,
        function: {
            name: 'sales_pipeline',
            description:
                'Воронка продаж на сейчас: в каких статусах стоят живые заказы, сколько их, на какую сумму и сколько дней не двигались. Отвечает на «что можно дотащить». Живыми считаются те, что трогали за последние N дней.',
            parameters: {
                type: 'object',
                properties: {
                    days: { type: 'integer', description: 'Какой давности изменения считать живыми. По умолчанию 45.' },
                },
            },
        },
    },
    {
        type: 'function' as const,
        function: {
            name: 'shtab_structure',
            description:
                'Структура компании: посты, кто кому подчинён, чей это пост, ЦКП и статистика поста, какие документы лежат в его папке. Вызывай, когда вопрос про оргсхему, подчинение, зоны ответственности или «кто за это отвечает».',
            parameters: { type: 'object', properties: {}, additionalProperties: false },
        },
    },
    {
        type: 'function' as const,
        function: {
            name: 'shtab_post_doc',
            description:
                'Прочитать текст документа поста — описание поста, инструкцию, регламент. Сначала посмотри структуру: там перечислены названия документов и их номера.',
            parameters: {
                type: 'object',
                properties: {
                    doc_id: { type: 'integer', description: 'Номер документа из shtab_structure.' },
                    post_id: { type: 'integer', description: 'Или номер поста — тогда вернутся все его документы.' },
                },
            },
        },
    },
    {
        type: 'function' as const,
        function: {
            name: 'tseh_people',
            description:
                'Работающие сотрудники из ЦехУспеха: идентификатор, ФИО, должность, отдел, цех. Вызывай перед тем, как сажать людей на посты: сажать надо по идентификатору отсюда, а не по фамилии из головы. Уволенных в списке нет.',
            parameters: { type: 'object', properties: {}, additionalProperties: false },
        },
    },
    {
        type: 'function' as const,
        function: {
            name: 'shtab_structure_apply',
            description:
                'Собрать структуру: завести посты, подчинить их друг другу, посадить людей, записать ЦКП и обязанности. Сначала скажи владельцу, что собираешься сделать, потом применяй. Минусы, разборы и проекты этим инструментом не трогаются — их ты не заводишь.',
            parameters: {
                type: 'object',
                properties: {
                    operations: {
                        type: 'array',
                        description: 'Операции по порядку.',
                        items: {
                            type: 'object',
                            properties: {
                                op: {
                                    type: 'string',
                                    enum: ['create_post', 'update_post', 'set_parent', 'set_holder'],
                                },
                                title: { type: 'string', description: 'Название нового поста (create_post).' },
                                post: { type: 'string', description: 'Какой пост меняем: номер или название.' },
                                parent: { type: 'string', description: 'Кому подчинить: номер, название или пусто для верхнего уровня.' },
                                holder_person_id: { type: 'string', description: 'Идентификатор человека из tseh_people.' },
                                vkp: { type: 'string', description: 'Ценный конечный продукт поста.' },
                                duties: { type: 'string', description: 'Обязанности поста.' },
                                statistic: { type: 'string', description: 'Еженедельная статистика поста.' },
                            },
                            required: ['op'],
                        },
                    },
                },
                required: ['operations'],
            },
        },
    },
    {
        type: 'function' as const,
        function: {
            name: 'tseh_staff_docs',
            description:
                'Опись документов по сотрудникам в ЦехУспехе: чьи, как называются, когда менялись. Отсюда берутся должностные инструкции, если они там есть.',
            parameters: { type: 'object', properties: {}, additionalProperties: false },
        },
    },
    {
        type: 'function' as const,
        function: {
            name: 'shtab_import_staff_doc',
            description:
                'Перенести документ сотрудника из ЦехУспеха в папку поста: файл сохраняется у нас, текст извлекается. Номер документа — из tseh_staff_docs.',
            parameters: {
                type: 'object',
                properties: {
                    doc_id: { type: 'string', description: 'Номер документа в ЦехУспехе.' },
                    post: { type: 'string', description: 'Пост, в папку которого класть: номер или название.' },
                },
                required: ['doc_id', 'post'],
            },
        },
    },
    {
        type: 'function' as const,
        function: {
            name: 'shtab_razbor_write',
            description:
                'Записать в открытый разбор то, что владелец уже продумал: стратегию, краткосрочную цель, логические блоки и программы с задачами. Пользуйся, когда он диктует или прикладывает свои материалы. Разбор ты не заводишь и не закрываешь — если открытого разбора нет, скажи об этом.',
            parameters: {
                type: 'object',
                properties: {
                    operations: {
                        type: 'array',
                        description: 'Операции по порядку. Блок заводится раньше своей программы.',
                        items: {
                            type: 'object',
                            properties: {
                                op: {
                                    type: 'string',
                                    enum: ['set_strategy', 'set_goal', 'create_block', 'save_program'],
                                },
                                razbor: { type: 'integer', description: 'Номер разбора. Без него — последний черновик.' },
                                text: { type: 'string', description: 'Текст стратегии (set_strategy).' },
                                goal_fix: { type: 'string', description: 'Что перестанет происходить.' },
                                goal_grow: { type: 'string', description: 'Что вырастет.' },
                                title: { type: 'string', description: 'Название логического блока.' },
                                excerpt: { type: 'string', description: 'Кусок стратегии, из которого блок вырезан.' },
                                rationale: { type: 'string', description: 'Почему это отдельный блок.' },
                                block: { type: 'string', description: 'Блок для программы: номер или название.' },
                                main_task: { type: 'string', description: 'Главная задача программы — результат, а не действие.' },
                                manager_name: { type: 'string', description: 'Кто ведёт программу.' },
                                tasks: {
                                    type: 'array',
                                    description: 'Задачи программы. Без производственных задач программа выполняется понарошку.',
                                    items: {
                                        type: 'object',
                                        properties: {
                                            kind: {
                                                type: 'string',
                                                enum: ['pervoocherednaya', 'zhiznenno_vazhnaya', 'rabochaya', 'proizvodstvennaya', 'uslovnaya'],
                                            },
                                            text: { type: 'string' },
                                            why: { type: 'string', description: 'Почему так — особенно у жизненно важных.' },
                                            metric: { type: 'string', description: 'Что считаем (производственные).' },
                                            target_value: { type: 'string', description: 'К какому числу приходим.' },
                                            source_note: { type: 'string', description: 'Откуда это число берётся.' },
                                        },
                                        required: ['kind', 'text'],
                                    },
                                },
                            },
                            required: ['op'],
                        },
                    },
                },
                required: ['operations'],
            },
        },
    },
    {
        type: 'function' as const,
        function: {
            name: 'catalog_search',
            description:
                'Найти позиции в каталоге витрины zmktlt.ru по словам из названия: имя, цена, категория, ссылка, продаётся ли сейчас. Цена — снимок на момент импорта витрины, не актуальный прайс.',
            parameters: {
                type: 'object',
                properties: {
                    query: { type: 'string', description: 'Слова из названия изделия.' },
                    limit: { type: 'integer', description: 'Сколько позиций вернуть, по умолчанию 15.' },
                },
                required: ['query'],
            },
        },
    },
    {
        type: 'function' as const,
        function: {
            name: 'catalog_overview',
            description:
                'Сводка по витрине zmktlt.ru: сколько позиций всего, сколько активных, у скольких есть цена, какие категории. Отвечает на «что у нас вообще выставлено».',
            parameters: { type: 'object', properties: {}, additionalProperties: false },
        },
    },
    {
        type: 'function' as const,
        function: {
            name: 'lvz_tables',
            description:
                'Что можно прочитать в базе соседнего проекта (сервис расчётов, маркетинг, продажи): список таблиц с назначением. Вызывай первым, когда вопрос про расчёты, проекты продаж или карточки товара.',
            parameters: { type: 'object', properties: {}, additionalProperties: false },
        },
    },
    {
        type: 'function' as const,
        function: {
            name: 'lvz_read',
            description:
                'Прочитать строки таблицы соседнего проекта. Итоги там не считаются — бери count_only, чтобы узнать количество, и строки, чтобы разобраться в содержимом. Столбцы неизвестны — посмотри их через limit 1.',
            parameters: {
                type: 'object',
                properties: {
                    table: { type: 'string', description: 'Имя таблицы из lvz_tables.' },
                    columns: { type: 'string', description: 'Через запятую; по умолчанию все.' },
                    filters: {
                        type: 'array',
                        description: 'Условия отбора.',
                        items: {
                            type: 'object',
                            properties: {
                                column: { type: 'string' },
                                op: { type: 'string', enum: ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'like', 'ilike'] },
                                value: { type: 'string' },
                            },
                            required: ['column', 'op', 'value'],
                        },
                    },
                    order: { type: 'string', description: 'По какому столбцу сортировать.' },
                    descending: { type: 'boolean', description: 'Сначала новые.' },
                    limit: { type: 'integer', description: 'До 200, по умолчанию 50.' },
                    count_only: { type: 'boolean', description: 'Вернуть только количество подходящих строк.' },
                },
                required: ['table'],
            },
        },
    },
    {
        type: 'function' as const,
        function: {
            name: 'lvz_calc_summary',
            description:
                'Сводка по сервису расчётов: сколько расчётов каждого вида за период, сколько всего, когда считали последний раз и кто. Отвечает на «пользуются ли расчётчиком».',
            parameters: {
                type: 'object',
                properties: { days: { type: 'integer', description: 'За сколько дней, по умолчанию 90.' } },
            },
        },
    },
    {
        type: 'function' as const,
        function: {
            name: 'shtab_query',
            description:
                'Задать базе произвольный вопрос запросом SELECT, когда готовых инструментов не хватает. Пользуйся, когда надо разобраться: проверить догадку, посчитать срез, сравнить периоды. Пиши запрос под PostgreSQL. ' +
                'Читать можно ВСЮ базу — все 145 таблиц, а не только перечисленные ниже. Закрыты только пароли и ключи входа. Не знаешь, где лежат нужные данные, — посмотри список таблиц запросом к information_schema.tables (и колонки через information_schema.columns) или найди таблицу в коде через code_search. ' +
                'С чего обычно начинают: ' +
                CORE_RELATIONS.join(', ') +
                '. Звонки и расшифровки — raw_telphin_calls, письма — incoming_emails, зарплата — salary_*, нарушения — okk_violations. ' +
                'Считай итоги в самом запросе (sum, count, group by), а не выгружай строки. Если запрос не выполнился — прочитай ошибку и перепиши.',
            parameters: {
                type: 'object',
                properties: {
                    sql: { type: 'string', description: 'Запрос SELECT. Один оператор, без точки с запятой в середине.' },
                    purpose: { type: 'string', description: 'Что проверяешь этим запросом — попадёт в журнал.' },
                },
                required: ['sql'],
            },
        },
    },
] as const;

// Инструменты цеха живут отдельным файлом: у них своя база, свой движок и своя
// причина отказать (база не подключена). Модели они видны единым списком.
//
// Настройки и код — тоже отдельно: у настроек своё правило (предлагать, но не
// применять), у кода свой источник (снимок репозитория, а не боевые таблицы).
export const SHTAB_TOOLS = [...OWN_TOOLS, ...TSEH_TOOLS, ...SETTINGS_TOOLS, ...CODE_TOOLS, ...DATA_TOOLS];

export const SHTAB_TOOL_NAMES: ReadonlySet<string> = new Set<string>(SHTAB_TOOLS.map((t) => t.function.name));

// ── состояние Штаба ────────────────────────────────────────────────────────────

async function readState(include: string[]): Promise<ToolResult> {
    const want = new Set(include.length > 0 ? include : ['minuses']);

    const { data: areas, error: areaError } = await supabase
        .from('shtab_area')
        .select('code, title, ordinal')
        .order('ordinal');
    if (areaError) throw new Error(areaError.message);

    const { data: minuses, error: minusError } = await supabase
        .from('shtab_minus')
        .select('id, text, area_code, source, occurred_on, done');
    if (minusError) throw new Error(minusError.message);

    const areaList = (areas ?? []) as ShtabArea[];
    const minusList = (minuses ?? []) as ShtabMinus[];
    const top = topArea(areaList, minusList);
    const titleByCode = new Map(areaList.map((a) => [a.code, a.title]));

    const result: ToolResult = {
        priority_area: top.area ? { title: top.area.title, open_minuses: top.count } : null,
        open_minuses_total: minusList.filter((m) => !m.done).length,
        by_area: areaList
            .map((a) => ({ area: a.title, open: top.counts[a.code] ?? 0 }))
            .sort((x, y) => y.open - x.open),
    };

    if (want.has('minuses')) {
        result.minuses = minusList
            .filter((m) => !m.done)
            .slice(0, MAX_ROWS)
            .map((m) => ({ id: m.id, text: m.text, area: titleByCode.get(m.area_code) ?? m.area_code }));
    }

    if (want.has('razbory')) {
        const { data, error } = await supabase
            .from('shtab_razbor')
            .select('id, area_code, status, situation, why, goal_fix, goal_grow, strategy, created_at')
            .order('created_at', { ascending: false })
            .limit(20);
        if (error) throw new Error(error.message);
        result.razbory = (data ?? []).map((r: any) => ({
            id: r.id,
            area: titleByCode.get(r.area_code) ?? r.area_code,
            status: r.status,
            created_at: r.created_at,
            situation: r.situation || null,
            why: r.why || null,
            goal: r.goal_fix || r.goal_grow ? { fix: r.goal_fix, grow: r.goal_grow } : null,
            has_strategy: Boolean(String(r.strategy || '').trim()),
        }));
    }

    if (want.has('projects')) {
        const { data, error } = await supabase
            .from('shtab_project')
            .select('id, title, owner_name, due_on, status')
            .order('due_on', { nullsFirst: false })
            .limit(MAX_ROWS);
        if (error) throw new Error(error.message);
        const today = new Date().toISOString().slice(0, 10);
        result.projects = (data ?? []).map((p: any) => ({
            title: p.title,
            owner: p.owner_name || null,
            due_on: p.due_on,
            status: p.status,
            overdue: p.status === 'open' && Boolean(p.due_on) && p.due_on < today,
        }));
    }

    if (want.has('posts')) {
        const { data, error } = await supabase
            .from('shtab_post')
            .select('title, area_code, ideal_scene, statistic, holder_name')
            .order('ordinal')
            .limit(MAX_ROWS);
        if (error) throw new Error(error.message);
        result.posts = (data ?? []).map((p: any) => ({
            title: p.title,
            area: p.area_code ? titleByCode.get(p.area_code) ?? p.area_code : null,
            ideal_scene: p.ideal_scene || null,
            statistic: p.statistic || null,
            holder: p.holder_name || null,
        }));
    }

    if (want.has('goals')) {
        const { data, error } = await supabase.from('shtab_goal').select('kind, text');
        if (error) throw new Error(error.message);
        result.goals = Object.fromEntries((data ?? []).map((g: any) => [g.kind, g.text || null]));
    }

    return result;
}

// ── что закрыто за период ──────────────────────────────────────────────────────

async function readHistory(days: number): Promise<ToolResult> {
    const since = new Date(Date.now() - days * 86_400_000).toISOString();

    const [closedRes, razborRes, projectRes] = await Promise.all([
        supabase
            .from('shtab_minus')
            .select('id, text, area_code, done_at')
            .eq('done', true)
            .gte('done_at', since)
            .order('done_at', { ascending: false })
            .limit(MAX_ROWS),
        supabase
            .from('shtab_razbor')
            .select('id, area_code, status, situation, why, updated_at')
            .eq('status', 'done')
            .gte('updated_at', since)
            .limit(50),
        supabase.from('shtab_project').select('id, title, owner_name, due_on, status').limit(MAX_ROWS),
    ]);
    const failed = [closedRes, razborRes, projectRes].find((r) => r.error);
    if (failed?.error) throw new Error(failed.error.message);

    const { data: areas } = await supabase.from('shtab_area').select('code, title');
    const titleByCode = new Map((areas ?? []).map((a: any) => [a.code, a.title]));

    const closedMinuses = closedRes.data ?? [];
    let links: Array<{ razbor_id: number; minus_id: number }> = [];
    if (closedMinuses.length > 0) {
        const { data } = await supabase
            .from('shtab_razbor_minus')
            .select('razbor_id, minus_id')
            .in('minus_id', closedMinuses.map((m: any) => m.id));
        links = (data ?? []) as typeof links;
    }
    const razborByMinus = new Map(links.map((l) => [l.minus_id, l.razbor_id]));

    const today = new Date().toISOString().slice(0, 10);
    const projects = projectRes.data ?? [];

    return {
        period_days: days,
        closed_minuses: closedMinuses.map((m: any) => ({
            text: m.text,
            area: titleByCode.get(m.area_code) ?? m.area_code,
            done_at: m.done_at,
            closed_by_razbor: razborByMinus.get(m.id) ?? null,
        })),
        closed_razbory: (razborRes.data ?? []).map((r: any) => ({
            id: r.id,
            area: titleByCode.get(r.area_code) ?? r.area_code,
            situation: r.situation || null,
            why: r.why || null,
        })),
        projects_done: projects.filter((p: any) => p.status === 'done').length,
        projects_open: projects.filter((p: any) => p.status === 'open').length,
        projects_overdue: projects
            .filter((p: any) => p.status === 'open' && p.due_on && p.due_on < today)
            .map((p: any) => ({ title: p.title, owner: p.owner_name || null, due_on: p.due_on })),
    };
}

// ── приход ─────────────────────────────────────────────────────────────────────

async function readIncome(months: number): Promise<ToolResult> {
    const { data, error } = await supabase
        .from('point_payments')
        .select('payment_date, amount_kopecks')
        .not('status', 'in', `(${NON_INCOME_STATUSES.join(',')})`)
        .gte('payment_date', monthsAgo(months, new Date()))
        .order('payment_date');
    if (error) throw new Error(error.message);

    // Текущий месяц не закончился: сравнивать его с полными месяцами нельзя,
    // он всегда будет выглядеть провалом.
    const currentMonth = new Date().toISOString().slice(0, 7);
    const points = monthlyIncome((data ?? []) as IncomeRow[]).filter((p) => p.month < currentMonth);
    const series = points.map((p) => p.rubles);
    const v = verdict(series);

    return {
        unit: 'рубли, приход на счета',
        caveat: 'Это приход, а не прибыль: расходов в данных нет. Переводы между своими счетами исключены.',
        months: points.map((p) => ({ month: p.month, rubles: Math.round(p.rubles) })),
        verdict: v.title,
        verdict_kind: v.kind,
    };
}

// ── разбор целиком и программы ─────────────────────────────────────────────────

async function readRazborDetail(razborId: number): Promise<ToolResult> {
    const { data: razbor, error } = await supabase
        .from('shtab_razbor')
        .select('id, area_code, status, situation, why, check_inside, check_res, check_relief, goal_fix, goal_grow, strategy')
        .eq('id', razborId)
        .maybeSingle();
    if (error) throw new Error(error.message);
    if (!razbor) return { available: false, reason: `Разбора ${razborId} нет` };

    const [{ data: areas }, { data: resources }, { data: blocks }] = await Promise.all([
        supabase.from('shtab_area').select('code, title'),
        supabase.from('shtab_resource').select('title, note, ordinal').eq('razbor_id', razborId).order('ordinal'),
        supabase.from('shtab_block').select('id, ordinal, title, excerpt, rationale').eq('razbor_id', razborId).order('ordinal'),
    ]);
    const titleByCode = new Map((areas ?? []).map((a: any) => [a.code, a.title]));

    return {
        id: razbor.id,
        area: titleByCode.get(razbor.area_code) ?? razbor.area_code,
        status: razbor.status,
        situation: razbor.situation || null,
        why: razbor.why || null,
        why_checks: {
            внутри_организации: razbor.check_inside,
            устранима_ресурсами: razbor.check_res,
            даёт_облегчение: razbor.check_relief,
        },
        goal: { fix: razbor.goal_fix || null, grow: razbor.goal_grow || null },
        // Ресурсы отдаются полностью: стратегия обязана собираться из имеющегося,
        // и программа тоже. Урезанная карта заставит модель придумывать ресурсы.
        resources: (resources ?? []).map((r: any) => ({ title: r.title, note: r.note || null })),
        strategy: razbor.strategy || null,
        blocks: (blocks ?? []).map((b: any) => ({
            id: b.id,
            ordinal: b.ordinal,
            title: b.title,
            excerpt: b.excerpt || null,
            rationale: b.rationale || null,
        })),
    };
}

async function readPrograms(razborId?: number): Promise<ToolResult> {
    let blockQuery = supabase.from('shtab_block').select('id, razbor_id, ordinal, title').order('ordinal');
    if (razborId) blockQuery = blockQuery.eq('razbor_id', razborId);
    const { data: blocks, error: blockError } = await blockQuery.limit(MAX_ROWS);
    if (blockError) throw new Error(blockError.message);
    if ((blocks ?? []).length === 0) return { programs: [], note: 'Программ ещё нет' };

    const blockIds = (blocks ?? []).map((b: any) => b.id);
    const { data: programs, error: programError } = await supabase
        .from('shtab_program')
        .select('id, block_id, main_task, manager_name, status')
        .in('block_id', blockIds);
    if (programError) throw new Error(programError.message);

    const programIds = (programs ?? []).map((p: any) => p.id);
    let tasks: any[] = [];
    if (programIds.length > 0) {
        const { data, error } = await supabase
            .from('shtab_task')
            .select('program_id, kind, ordinal, text, metric, target_value, source_note, fact_value, done')
            .in('program_id', programIds)
            .order('ordinal');
        if (error) throw new Error(error.message);
        tasks = data ?? [];
    }

    const blockById = new Map<number, { title: string }>((blocks ?? []).map((b: any) => [b.id, b]));

    return {
        programs: (programs ?? []).map((p: any) => {
            const own = tasks.filter((t) => t.program_id === p.id);
            return {
                id: p.id,
                block: blockById.get(p.block_id)?.title ?? null,
                main_task: p.main_task || null,
                manager: p.manager_name || null,
                status: p.status,
                // Производственные задачи целиком: по ним и видно, отстаёт программа
                // или идёт. Пустая цель со ссылкой на замер — это не пропуск в
                // данных, а честно отложенное число.
                proizvodstvennye: own
                    .filter((t) => t.kind === 'proizvodstvennaya')
                    .map((t) => ({
                        text: t.text,
                        metric: t.metric || null,
                        target: t.target_value || null,
                        fact: t.fact_value || null,
                        source_note: t.source_note || null,
                    })),
                rabochih_vsego: own.filter((t) => t.kind === 'rabochaya').length,
                rabochih_sdelano: own.filter((t) => t.kind === 'rabochaya' && t.done).length,
            };
        }),
    };
}

export async function executeShtabTool(
    name: string,
    args: any,
    ctx: ToolContext = {},
): Promise<ToolResult> {
    // Цеховые — до try: они сами возвращают причину отказа, а не бросают.
    if (TSEH_TOOL_NAMES.has(name)) return await executeTsehTool(name, args);
    // Настройки и код — тоже: они возвращают отказ текстом, чтобы модель
    // прочитала причину и исправилась, а не уронила разговор.
    if (SETTINGS_TOOL_NAMES.has(name)) return await executeSettingsTool(name, args, ctx);
    if (CODE_TOOL_NAMES.has(name)) return await executeCodeTool(name, args);
    if (DATA_TOOL_NAMES.has(name)) return await executeDataTool(name, args);

    if (name === 'sales_facts') {
        const months = Number.isFinite(Number(args?.months)) ? Math.min(36, Math.max(2, Number(args.months))) : 12;
        const { data, error } = await supabase.rpc('sales_month_facts', { p_months: months });
        if (error) return { available: false, reason: error.message };
        return {
            unit: 'рубли',
            note: 'Продажа = заказ ушёл в производство. По этому же критерию считается зарплата отдела.',
            months: data ?? [],
        };
    }

    if (name === 'sales_pipeline') {
        const days = Number.isFinite(Number(args?.days)) ? Math.min(180, Math.max(7, Number(args.days))) : 45;
        const { data, error } = await supabase.rpc('sales_pipeline_now', { p_days: days });
        if (error) return { available: false, reason: error.message };
        return { unit: 'рубли', fresh_days: days, statuses: data ?? [] };
    }

    if (name === 'shtab_structure') {
        const { posts, docs } = await loadStructure();
        if (posts.length === 0) {
            return { available: false, reason: 'Структура ещё не заведена: постов нет.' };
        }
        return {
            note: 'Структуру ведёт владелец вручную. Пост без держателя — вакансия, а не ошибка.',
            posts_count: posts.length,
            tree: formatStructure(posts, docs),
            docs: docs.map((d) => ({ doc_id: d.id, post_id: d.post_id, title: d.title, readable: d.has_text })),
        };
    }

    if (name === 'shtab_post_doc') {
        const docId = Number(args?.doc_id);
        const postId = Number(args?.post_id);
        let q = supabase.from('shtab_post_doc').select('id, post_id, title, file_name, text_content');
        if (Number.isInteger(docId) && docId > 0) q = q.eq('id', docId);
        else if (Number.isInteger(postId) && postId > 0) q = q.eq('post_id', postId);
        else return { available: false, reason: 'Нужен doc_id или post_id.' };

        const { data, error } = await q.limit(5);
        if (error) return { available: false, reason: error.message };
        if (!data?.length) return { available: false, reason: 'Такого документа нет.' };

        return {
            documents: data.map((d: any) => ({
                doc_id: d.id,
                post_id: d.post_id,
                title: d.title,
                file_name: d.file_name,
                // Пусто — это скан без распознавания или формат, который не
                // разбирается. Молчать об этом нельзя: иначе выйдет, что
                // документ прочитан и в нём ничего нет.
                text: (d.text_content ?? '').trim() || null,
                reason: (d.text_content ?? '').trim() ? undefined : 'Текст из файла не извлёкся — прочитать нечем.',
            })),
        };
    }

    if (name === 'tseh_people') {
        return (await tsehPeople()) as ToolResult;
    }

    if (name === 'tseh_staff_docs') {
        const res = await tsehStaffDocs();
        return {
            ...res,
            note: 'Это опись документов ЦехУспеха, а не папки постов. Перенести нужный — shtab_import_staff_doc.',
        } as ToolResult;
    }

    if (name === 'shtab_structure_apply') {
        const ops = Array.isArray(args?.operations) ? args.operations : [];
        if (ops.length === 0) return { available: false, reason: 'Операций не передано.' };
        if (ops.length > 60) return { available: false, reason: 'Слишком много операций за раз — разбей на части.' };
        // Люди подтягиваются здесь же: фамилию на пост надо ставить из
        // ЦехУспеха, а не из того, что модель помнит.
        const { people } = await tsehPeople();
        const { results } = await applyStructureOps(ops as StructureOp[], people);
        return {
            done: results.filter((r) => r.ok).map((r) => r.what),
            skipped: results.filter((r) => !r.ok).map((r) => r.what),
            note: 'Схема уже изменилась — владелец видит её на вкладке «Структура». Перескажи ему, что вышло.',
        };
    }

    if (name === 'shtab_import_staff_doc') {
        return await importStaffDoc(String(args?.doc_id ?? ''), args?.post);
    }

    if (name === 'shtab_razbor_write') {
        const ops = Array.isArray(args?.operations) ? args.operations : [];
        if (ops.length === 0) return { available: false, reason: 'Операций не передано.' };
        if (ops.length > 40) return { available: false, reason: 'Слишком много операций за раз — разбей на части.' };
        const results = await applyRazborOps(ops as RazborOp[]);
        return {
            done: results.filter((r) => r.ok).map((r) => r.what),
            skipped: results.filter((r) => !r.ok).map((r) => r.what),
            // Находки проверок — не придирка: программа без производственных
            // задач выполняется по шагам и не меняет положения дел.
            checks: results.flatMap((r) => r.problems ?? []),
            note: 'Записанное владелец видит на вкладках «Стратегия» и «Программы». Перескажи ему, что вышло, и назови находки проверок.',
        };
    }

    if (name === 'lvz_tables') {
        return lvzTables() as ToolResult;
    }

    if (name === 'lvz_read') {
        return (await lvzRead({
            table: String(args?.table ?? ''),
            columns: args?.columns ? String(args.columns) : undefined,
            filters: Array.isArray(args?.filters) ? args.filters : [],
            order: args?.order ? String(args.order) : undefined,
            descending: Boolean(args?.descending),
            limit: Number(args?.limit) || undefined,
            count_only: Boolean(args?.count_only),
        })) as ToolResult;
    }

    if (name === 'lvz_calc_summary') {
        return (await lvzCalcSummary(Number(args?.days) || 90)) as ToolResult;
    }

    if (name === 'catalog_search') {
        return (await catalogSearch(String(args?.query ?? ''), Number(args?.limit) || 15)) as ToolResult;
    }

    if (name === 'catalog_overview') {
        return (await catalogOverview()) as ToolResult;
    }

    if (name === 'shtab_query') {
        // Ошибка запроса возвращается модели текстом: увидеть, что запрос
        // неверный, и переписать его — это и есть работа аналитика.
        return (await runTamaraQuery(String(args?.sql ?? ''), String(args?.purpose ?? ''))) as ToolResult;
    }

    try {
        if (name === 'shtab_state') {
            return await readState(Array.isArray(args?.include) ? args.include : []);
        }
        if (name === 'shtab_history') {
            const days = Number.isFinite(Number(args?.days)) ? Math.min(365, Math.max(1, Number(args.days))) : 30;
            return await readHistory(days);
        }
        if (name === 'money_in') {
            const months = Number.isFinite(Number(args?.months)) ? Math.min(60, Math.max(2, Number(args.months))) : 24;
            return await readIncome(months);
        }
        if (name === 'shtab_razbor_detail') {
            const id = Number(args?.razbor_id);
            if (!Number.isFinite(id)) return { available: false, reason: 'Не передан razbor_id' };
            return await readRazborDetail(id);
        }
        if (name === 'shtab_programs') {
            const id = Number(args?.razbor_id);
            return await readPrograms(Number.isFinite(id) ? id : undefined);
        }
        return { available: false, reason: `Неизвестный инструмент: ${name}` };
    } catch (e: any) {
        // Ошибку возвращаем модели текстом, а не бросаем: пусть она честно скажет
        // владельцу, что данные не поднялись, вместо того чтобы отвечать по памяти.
        return { available: false, reason: `Не удалось получить данные: ${e.message}` };
    }
}
