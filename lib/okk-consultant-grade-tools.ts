/**
 * Грейды отдела для Семёна.
 *
 * Вопрос «по итогам октября у кого какой грейд» он закрывал статьёй про то,
 * что такое грейд: спросить данные было нечем — есть только «мой рейтинг»
 * (жалоба владельца 02.11.2026).
 *
 * Два слоя, и путать их нельзя:
 *   • `salary_grade` — действующий грейд менеджера (ранг, который умножает
 *     переменную часть);
 *   • `salary_grade_eval` — зачтён ли месяц для грейда. Считается при закрытии
 *     периода, поэтому у открытого месяца оценки нет, и это не поломка.
 */
import { supabase } from '@/utils/supabase';
import { formatRub } from '@/lib/format';

export const GRADE_TOOLS = [
    {
        type: 'function' as const,
        function: {
            name: 'team_grades',
            description:
                'Грейды менеджеров: какой у кого действует сейчас или на начало указанного месяца, с какой даты и поставлен вручную или автоматически. Если указан месяц — добавляет, зачтён ли он для грейда (оценка считается при закрытии периода; у открытого месяца её нет). Отдаёт и основание грейда: месяц, по которому его посчитали, и расклад показателей — выполнение плана, скоринг ОКК, конверсия, средний чек. Вызывай на вопросы «у кого какой грейд», «кто на каком грейде», «почему у меня такой грейд», «изменился ли грейд за месяц». Менеджер видит только свой грейд.',
            parameters: {
                type: 'object',
                properties: {
                    year: { type: 'integer', description: 'Год, например 2026. Без него — грейды на сегодня.' },
                    month: { type: 'integer', description: 'Месяц 1–12. Без него — грейды на сегодня.' },
                },
            },
        },
    },
] as const;

export const GRADE_TOOL_NAMES: ReadonlySet<string> = new Set<string>(GRADE_TOOLS.map((t) => t.function.name));

const MONTHS = [
    'январь', 'февраль', 'март', 'апрель', 'май', 'июнь',
    'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь',
];

/**
 * Месяц, из которого вырос действующий грейд: грейд считается по закрытому
 * месяцу и применяется со следующего, поэтому основание — месяц перед датой
 * начала действия.
 */
function basisMonthOf(effectiveFrom: string): { year: number; month: number } | null {
    const date = new Date(effectiveFrom);
    if (Number.isNaN(date.getTime())) return null;
    const year = date.getUTCFullYear();
    const month = date.getUTCMonth(); // 0-based: месяц перед effective_from
    return month === 0 ? { year: year - 1, month: 12 } : { year, month };
}

/** Критерий грейда человеческими словами: что мерили, сколько вышло, зачлось ли. */
function criterionText(criterion: any): string {
    const label = String(criterion?.label ?? criterion?.metric ?? 'показатель');
    const value = Number(criterion?.value);
    const metric = String(criterion?.metric ?? '');
    const decimal = (n: number) => n.toFixed(1).replace('.', ',');
    const shown = !Number.isFinite(value)
        ? '—'
        : metric === 'avg_check'
            ? formatRub(value)
            : metric === 'okk_total_score'
                ? `${decimal(value)} балла`
                : `${decimal(value)} %`;
    const threshold = Number.isFinite(Number(criterion?.threshold)) ? ` (нужно от ${Number(criterion.threshold)} %)` : '';
    const place = criterion?.mode === 'dept_rank' && criterion?.rank ? `, ${criterion.rank}-й показатель отбора` : '';
    return `${label}: ${shown}${threshold}${place} — ${criterion?.passed ? 'зачтено' : 'не зачтено'}`;
}

/** Роли, которым видно весь отдел. Менеджеру — только он сам. */
function seesWholeTeam(role?: string | null): boolean {
    return role === 'admin' || role === 'okk' || role === 'rop';
}

export async function executeGradeTool(
    name: string,
    args: any,
    ctx: { userRole?: string; retailCrmManagerId?: number | null },
): Promise<any> {
    if (name !== 'team_grades') return { available: false, reason: `Неизвестный инструмент грейдов: ${name}` };

    const year = Number(args?.year) || null;
    const month = Number(args?.month) || null;
    const onDate = year && month ? new Date(Date.UTC(year, month - 1, 1)) : new Date();

    const { data: grades, error } = await supabase
        .from('salary_grade')
        .select('manager_id, grade_level, effective_from, source')
        .lte('effective_from', onDate.toISOString())
        .order('effective_from', { ascending: false });

    if (error) return { available: false, reason: error.message };

    // Действующий грейд — последняя запись до этой даты по каждому менеджеру.
    const current = new Map<number, any>();
    for (const row of (grades ?? []) as any[]) {
        const id = Number(row.manager_id);
        if (!current.has(id)) current.set(id, row);
    }

    // Грейдов на эту дату нет вовсе — скорее всего спросили про год, когда
    // грейдов ещё не вели. Молчаливая пустота читается как «данных нет»,
    // поэтому говорим, с какого момента они есть.
    if (current.size === 0) {
        const { data: earliest } = await supabase
            .from('salary_grade')
            .select('effective_from')
            .order('effective_from', { ascending: true })
            .limit(1);
        const from = (earliest ?? [])[0]?.effective_from ?? null;
        return {
            available: false,
            reason: from
                ? `На ${year && month ? `начало ${String(month).padStart(2, '0')}.${year}` : 'эту дату'} грейдов не было: их ведут с ${String(from).slice(0, 10)}. Спроси про более поздний период.`
                : 'Грейды в системе ещё не заводили.',
        };
    }

    let managerIds = Array.from(current.keys());
    if (!seesWholeTeam(ctx.userRole)) {
        const mine = ctx.retailCrmManagerId ? Number(ctx.retailCrmManagerId) : null;
        managerIds = mine && current.has(mine) ? [mine] : [];
        if (managerIds.length === 0) {
            return { available: false, reason: 'Грейд для вас не найден, а чужие грейды показывать нельзя.' };
        }
    }

    // Основание грейда: расклад того месяца, по которому его посчитали. Без
    // него на «почему именно такой» Семён отвечал «расшифровки нет» — а она
    // лежит в `detail` оценки (ЗАКОН: любое число раскладывается до данных).
    const basisKeys = new Map<number, { year: number; month: number }>();
    for (const id of managerIds) {
        const basis = basisMonthOf(current.get(id).effective_from);
        if (basis) basisKeys.set(id, basis);
    }
    const basisPeriods = Array.from(new Set(Array.from(basisKeys.values()).map((b) => `${b.year}-${b.month}`)));

    const [{ data: managers }, { data: evals }, basisRows] = await Promise.all([
        supabase.from('managers').select('id, first_name, last_name, active').in('id', managerIds),
        year && month
            ? supabase
                .from('salary_grade_eval')
                .select('manager_id, qualified')
                .eq('year', year)
                .eq('month', month)
                .in('manager_id', managerIds)
            : Promise.resolve({ data: [] } as any),
        Promise.all(basisPeriods.map(async (key) => {
            const [y, m] = key.split('-').map(Number);
            const { data } = await supabase
                .from('salary_grade_eval')
                .select('manager_id, qualified, detail')
                .eq('year', y)
                .eq('month', m)
                .in('manager_id', managerIds);
            return ((data ?? []) as any[]).map((row) => ({ ...row, year: y, month: m }));
        })).then((chunks) => chunks.flat()),
    ]);

    const basisById = new Map<number, any>();
    for (const row of basisRows) {
        const want = basisKeys.get(Number(row.manager_id));
        if (want && want.year === row.year && want.month === row.month) basisById.set(Number(row.manager_id), row);
    }

    // ЗАКОН «только активные сущности»: в списке грейдов отдела не место тем,
    // кто уже не работает. Свой грейд человек видит всегда.
    const nameById = new Map<number, string>();
    const activeIds = new Set<number>();
    for (const row of (managers ?? []) as any[]) {
        nameById.set(Number(row.id), [row.first_name, row.last_name].filter(Boolean).join(' '));
        if (row.active === true) activeIds.add(Number(row.id));
    }
    const mineId = ctx.retailCrmManagerId ? Number(ctx.retailCrmManagerId) : null;
    managerIds = managerIds.filter((id) => activeIds.has(id) || id === mineId);
    const qualifiedById = new Map<number, boolean>();
    for (const row of (evals ?? []) as any[]) qualifiedById.set(Number(row.manager_id), Boolean(row.qualified));

    /** Из чего вырос грейд: месяц, итог и расклад показателей. */
    const basisOf = (id: number) => {
        const row = basisById.get(id);
        const key = basisKeys.get(id);
        if (!row || !key) {
            return key
                ? { period: `${MONTHS[key.month - 1]} ${key.year}`, note: 'Оценки этого месяца в базе нет — грейд, скорее всего, поставлен вручную.' }
                : undefined;
        }
        const criteria = Array.isArray(row.detail?.criteria) ? row.detail.criteria : [];
        return {
            period: `${MONTHS[key.month - 1]} ${key.year}`,
            qualified: Boolean(row.qualified),
            place: row.detail?.place ?? null,
            criteria: criteria.map(criterionText),
        };
    };

    const rows = managerIds.map((id) => {
        const grade = current.get(id);
        return {
            manager: nameById.get(id) ?? `менеджер ${id}`,
            grade: grade.grade_level,
            since: grade.effective_from,
            source: grade.source === 'manual' ? 'поставлен вручную' : 'посчитан автоматически',
            monthQualified: year && month
                ? (qualifiedById.has(id) ? qualifiedById.get(id) : null)
                : undefined,
            basis: basisOf(id),
        };
    }).sort((a, b) => a.grade - b.grade || a.manager.localeCompare(b.manager, 'ru'));

    return {
        available: true,
        on: year && month ? `на начало ${String(month).padStart(2, '0')}.${year}` : 'на сегодня',
        scale: 'грейд 1 — высший, грейд 3 — стартовый и самый низкий',
        managers: rows,
        monthEvaluated: year && month
            ? ((evals ?? []).length > 0 ? true : false)
            : undefined,
        note: year && month && (evals ?? []).length === 0
            ? 'Оценки этого месяца нет: она считается при закрытии периода, а месяц ещё открыт.'
            : undefined,
    };
}
