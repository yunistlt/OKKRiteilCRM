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

export const GRADE_TOOLS = [
    {
        type: 'function' as const,
        function: {
            name: 'team_grades',
            description:
                'Грейды менеджеров: какой у кого действует сейчас или на начало указанного месяца, с какой даты и поставлен вручную или автоматически. Если указан месяц — добавляет, зачтён ли он для грейда (оценка считается при закрытии периода; у открытого месяца её нет). Вызывай на вопросы «у кого какой грейд», «кто на каком грейде», «изменился ли грейд за месяц». Менеджер видит только свой грейд.',
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

    const [{ data: managers }, { data: evals }] = await Promise.all([
        supabase.from('managers').select('id, first_name, last_name').in('id', managerIds),
        year && month
            ? supabase
                .from('salary_grade_eval')
                .select('manager_id, qualified')
                .eq('year', year)
                .eq('month', month)
                .in('manager_id', managerIds)
            : Promise.resolve({ data: [] } as any),
    ]);

    const nameById = new Map<number, string>();
    for (const row of (managers ?? []) as any[]) {
        nameById.set(Number(row.id), [row.first_name, row.last_name].filter(Boolean).join(' '));
    }
    const qualifiedById = new Map<number, boolean>();
    for (const row of (evals ?? []) as any[]) qualifiedById.set(Number(row.manager_id), Boolean(row.qualified));

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
