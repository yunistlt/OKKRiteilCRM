import { supabase } from '@/utils/supabase';
import { KIND_ORDER, TASK_KINDS } from '@/lib/shtab/programs';
import type { TaskKind } from '@/lib/shtab/programs';

// Задачи одного исполнителя — то, чем Штаб кормит консультанта ЦехУспеха.
//
// ГЛАВНОЕ ОГРАНИЧЕНИЕ. Отсюда уходит только то, что относится к САМОМУ человеку:
// его программы и их задачи. Ни минусов, ни приоритетной области, ни чужих
// программ, ни текста стратегии. Штаб закрыт ролью admin не из вредности — в нём
// лежат все проблемы компании, включая кадровые и финансовые, и начальнику цеха
// там делать нечего. Этот слой существует, чтобы отдать человеку его работу, а не
// приоткрыть Штаб.
//
// Второе: адресат — ПОСТ, а не фамилия. Программа закреплена за постом, у поста
// есть занимающий с учёткой в ЦехУспехе. Уволился человек — программа осталась.

export type DutyTask = {
    id: number;
    kind: TaskKind;
    kindTitle: string;
    kindHint: string;
    ordinal: number;
    text: string;
    why: string;
    metric: string;
    target: string;
    fact: string;
    sourceNote: string;
    done: boolean;
    /** Срок из связанного проекта, если задача заведена проектом. */
    dueOn: string | null;
    overdue: boolean;
    lastReport: { kind: string; text: string; at: string } | null;
};

export type DutyProgram = {
    programId: number;
    block: string;
    mainTask: string;
    status: string;
    tasks: DutyTask[];
    /** Что застряло дольше всего — с этого начинается ежедневная планёрка. */
    stuck: Array<{ taskId: number; text: string; said: string; days: number }>;
};

export type DutyView = {
    post: { id: number; title: string; holder: string; idealScene: string; statistic: string } | null;
    programs: DutyProgram[];
};

/** Пост по внешнему идентификатору из ЦехУспеха. Сравнение точное, без догадок. */
export async function findPost(externalUid: string) {
    const uid = (externalUid || '').trim();
    if (!uid) return null;
    const { data, error } = await supabase
        .from('shtab_post')
        .select('id, title, holder_name, ideal_scene, statistic')
        .eq('external_uid', uid)
        .maybeSingle();
    if (error) throw new Error(error.message);
    return data ?? null;
}

function daysSince(iso: string, now: number): number {
    const ts = Date.parse(iso);
    if (!Number.isFinite(ts)) return 0;
    return Math.max(0, Math.floor((now - ts) / 86_400_000));
}

/**
 * Всё, что относится к человеку: его программы, задачи, сроки и что застряло.
 *
 * Пустой ответ — не ошибка: пост может быть не заведён или программ у него ещё
 * нет. Консультант должен сказать об этом прямо, а не молчать.
 */
export async function dutyView(externalUid: string, now = Date.now()): Promise<DutyView> {
    const post = await findPost(externalUid);
    if (!post) return { post: null, programs: [] };

    const { data: programs, error: pe } = await supabase
        .from('shtab_program')
        .select('id, block_id, main_task, status')
        .eq('post_id', post.id)
        // Брошенные программы человеку показывать незачем.
        .in('status', ['draft', 'active']);
    if (pe) throw new Error(pe.message);
    if ((programs ?? []).length === 0) {
        return { post: { id: post.id, title: post.title, holder: post.holder_name, idealScene: post.ideal_scene, statistic: post.statistic }, programs: [] };
    }

    const programIds = programs!.map((p: any) => p.id);
    const blockIds = Array.from(new Set(programs!.map((p: any) => p.block_id)));

    const [blocksRes, tasksRes, kindsRes] = await Promise.all([
        supabase.from('shtab_block').select('id, title').in('id', blockIds),
        supabase
            .from('shtab_task')
            .select('id, program_id, kind, ordinal, text, why, metric, target_value, source_note, fact_value, done, project_id')
            .in('program_id', programIds)
            .order('ordinal'),
        supabase.from('shtab_task_kind').select('code, title, hint').order('ordinal'),
    ]);
    if (blocksRes.error) throw new Error(blocksRes.error.message);
    if (tasksRes.error) throw new Error(tasksRes.error.message);
    if (kindsRes.error) throw new Error(kindsRes.error.message);

    const tasks = tasksRes.data ?? [];
    const taskIds = tasks.map((t: any) => t.id);
    const projectIds = tasks.map((t: any) => t.project_id).filter(Boolean);

    const [reportsRes, projectsRes] = await Promise.all([
        taskIds.length > 0
            ? supabase
                  .from('shtab_task_report')
                  .select('task_id, kind, text, created_at')
                  .in('task_id', taskIds)
                  .order('created_at', { ascending: false })
            : Promise.resolve({ data: [] as any[], error: null }),
        projectIds.length > 0
            ? supabase.from('shtab_project').select('id, due_on').in('id', projectIds)
            : Promise.resolve({ data: [] as any[], error: null }),
    ]);
    if (reportsRes.error) throw new Error(reportsRes.error.message);
    if (projectsRes.error) throw new Error(projectsRes.error.message);

    const blockTitle = new Map<number, string>((blocksRes.data ?? []).map((b: any) => [b.id, b.title]));
    const kindInfo = new Map<string, { title: string; hint: string }>(
        (kindsRes.data ?? []).map((k: any) => [k.code, { title: k.title, hint: k.hint }]),
    );
    const dueByProject = new Map<number, string | null>((projectsRes.data ?? []).map((p: any) => [p.id, p.due_on]));

    // Последний по времени отчёт на задачу: список уже отсортирован от свежих.
    const lastReport = new Map<number, { kind: string; text: string; created_at: string }>();
    for (const r of reportsRes.data ?? []) {
        if (!lastReport.has(r.task_id)) lastReport.set(r.task_id, r);
    }

    const today = new Date(now).toISOString().slice(0, 10);

    const built: DutyProgram[] = programs!.map((p: any) => {
        const own = tasks
            .filter((t: any) => t.program_id === p.id)
            .sort((a: any, b: any) => KIND_ORDER[a.kind as TaskKind] - KIND_ORDER[b.kind as TaskKind] || a.ordinal - b.ordinal);

        const dutyTasks: DutyTask[] = own.map((t: any) => {
            const due = t.project_id ? dueByProject.get(t.project_id) ?? null : null;
            const report = lastReport.get(t.id) ?? null;
            return {
                id: t.id,
                kind: t.kind,
                kindTitle: kindInfo.get(t.kind)?.title ?? t.kind,
                kindHint: kindInfo.get(t.kind)?.hint ?? '',
                ordinal: t.ordinal,
                text: t.text,
                why: t.why || '',
                metric: t.metric || '',
                target: t.target_value || '',
                fact: t.fact_value || '',
                sourceNote: t.source_note || '',
                done: t.done,
                dueOn: due,
                overdue: Boolean(due && !t.done && due < today),
                lastReport: report ? { kind: report.kind, text: report.text, at: report.created_at } : null,
            };
        });

        const stuck = dutyTasks
            .filter((t) => t.lastReport?.kind === 'stuck')
            .map((t) => ({
                taskId: t.id,
                text: t.text,
                said: t.lastReport!.text,
                days: daysSince(t.lastReport!.at, now),
            }))
            .sort((a, b) => b.days - a.days);

        return {
            programId: p.id,
            block: blockTitle.get(p.block_id) ?? '',
            mainTask: p.main_task || '',
            status: p.status,
            tasks: dutyTasks,
            stuck,
        };
    });

    return {
        post: { id: post.id, title: post.title, holder: post.holder_name, idealScene: post.ideal_scene, statistic: post.statistic },
        programs: built,
    };
}

/**
 * Принадлежит ли задача этому человеку.
 *
 * Проверяется перед КАЖДОЙ записью отчёта, а не только при чтении. Иначе, зная
 * чужой номер задачи, можно было бы отметить её выполненной — и сводка владельца
 * стала бы врать.
 */
export async function ownsTask(externalUid: string, taskId: number): Promise<boolean> {
    const post = await findPost(externalUid);
    if (!post) return false;

    const { data, error } = await supabase
        .from('shtab_task')
        .select('id, shtab_program!inner(post_id)')
        .eq('id', taskId)
        .eq('shtab_program.post_id', post.id)
        .maybeSingle();
    if (error) throw new Error(error.message);
    return Boolean(data);
}

export const REPORT_KINDS = ['done', 'stuck', 'note'] as const;
export type ReportKind = (typeof REPORT_KINDS)[number];

export async function saveReport(taskId: number, kind: ReportKind, text: string, by: string): Promise<number> {
    const { data, error } = await supabase.rpc('shtab_task_report', {
        p_task_id: taskId,
        p_kind: kind,
        p_text: text,
        p_by: by,
    });
    if (error) throw new Error(error.message);
    return data as number;
}

/** Все типы задач известны — на случай, если справочник разойдётся с кодом. */
export function isKnownKind(kind: string): kind is TaskKind {
    return (TASK_KINDS as readonly string[]).includes(kind);
}
