import { supabase } from '@/utils/supabase';
import { NON_INCOME_STATUSES, monthlyIncome, monthsAgo } from '@/lib/shtab/income';
import type { IncomeRow } from '@/lib/shtab/income';
import { topArea } from '@/lib/shtab/types';
import type { ShtabArea, ShtabMinus } from '@/lib/shtab/types';
import { verdict } from '@/lib/shtab/xmr';
import { TSEH_TOOLS, TSEH_TOOL_NAMES, executeTsehTool } from '@/lib/shtab/tseh-tools';
import { ALLOWED_RELATIONS, runTamaraQuery } from '@/lib/shtab/tamara-sql';

// Инструменты Тамары (OpenAI function calling).
//
// Через них — и только через них — Тамара узнаёт что-либо о компании. Модель не
// получает доступа к SQL: запросы живут здесь, в коде, а модель вызывает
// именованные функции с типизированными параметрами. Модель, пишущая
// произвольный SQL по боевой базе, однажды обязательно напишет не тот запрос.
//
// Набор намеренно узкий. Сюда попало только то, чьи таблицы я могу проверить:
// собственные таблицы Штаба и point_payments (её схема лежит в migrations/).
// Заказы не переписываю — переиспользую готовые инструменты Семёна
// (lib/okk-consultant-orders-tools.ts), они уже работают в проде.
//
// Чего здесь нет и почему: рекламации и постоянные клиенты считаются по orders,
// statuses и salary_client_canon — таблицам, созданным прямо в Supabase, без
// определений в migrations/. Запрос по догадке дал бы правдоподобное и
// непроверяемое число, а на словах Тамары владелец принимает решения.

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
            name: 'shtab_query',
            description:
                'Задать базе произвольный вопрос запросом SELECT, когда готовых инструментов не хватает. Пользуйся, когда надо разобраться: проверить догадку, посчитать срез, сравнить периоды. Пиши запрос под PostgreSQL. Доступные таблицы: ' +
                ALLOWED_RELATIONS.join(', ') +
                '. Считай итоги в самом запросе (sum, count, group by), а не выгружай строки. Если запрос не выполнился — прочитай ошибку и перепиши.',
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
export const SHTAB_TOOLS = [...OWN_TOOLS, ...TSEH_TOOLS];

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

export async function executeShtabTool(name: string, args: any): Promise<ToolResult> {
    // Цеховые — до try: они сами возвращают причину отказа, а не бросают.
    if (TSEH_TOOL_NAMES.has(name)) return await executeTsehTool(name, args);

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
