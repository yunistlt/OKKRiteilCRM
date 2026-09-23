import { supabase } from '@/utils/supabase';
import { checkProgram } from '@/lib/shtab/program-checks';
import { TASK_KINDS } from '@/lib/shtab/programs';
import type { ProgramDraft, TaskKind } from '@/lib/shtab/programs';

// Запись разбора под диктовку: стратегия, логические блоки, программы.
//
// Нужно это затем, что стратегия и программы у владельца часто уже написаны —
// в miro, в документе, на бумаге. Перенабирать их руками по полям он не станет,
// а без них Штаб пустой: программы и есть то место, где у разбора появляются
// производственные задачи.
//
// Разбор Тамара НЕ заводит и не закрывает — он начинается с минуса и области,
// и это решение владельца. Она пишет внутрь уже открытого разбора.
//
// Проверки программы прогоняются здесь же (lib/shtab/program-checks.ts) и
// возвращаются вместе с результатом: они детерминированы, и программа, которую
// продиктовали, обязана проходить их наравне с написанной руками.

export type RazborOp =
    | { op: 'set_strategy'; razbor?: number; text: string }
    | { op: 'set_goal'; razbor?: number; goal_fix?: string; goal_grow?: string }
    | { op: 'create_block'; razbor?: number; title: string; excerpt?: string; rationale?: string }
    | {
          op: 'save_program';
          block: string | number;
          main_task: string;
          manager_name?: string;
          tasks: Array<{ kind: string; text: string; why?: string; metric?: string; target_value?: string; source_note?: string }>;
      };

export type RazborOutcome = { op: string; ok: boolean; what: string; problems?: string[] };

type RazborRow = { id: number; area_code: string; status: string; created_at: string };

/**
 * Разбор, в который писать, если владелец не назвал номер: последний черновик,
 * а если черновиков нет — последний по времени. Готовый разбор трогать плохо,
 * поэтому черновик всегда в приоритете.
 */
async function pickRazbor(explicit?: number): Promise<RazborRow | null> {
    if (explicit) {
        const { data, error } = await supabase
            .from('shtab_razbor')
            .select('id, area_code, status, created_at')
            .eq('id', explicit)
            .maybeSingle();
        if (error) throw new Error(error.message);
        return (data as RazborRow) ?? null;
    }
    const { data, error } = await supabase
        .from('shtab_razbor')
        .select('id, area_code, status, created_at')
        .order('created_at', { ascending: false })
        .limit(20);
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as RazborRow[];
    return rows.find((r) => r.status === 'draft') ?? rows[0] ?? null;
}

const NO_RAZBOR = 'разбора нет — открой его на вкладке «Разбор», он начинается с минуса и области';

export async function applyRazborOps(ops: RazborOp[]): Promise<RazborOutcome[]> {
    const results: RazborOutcome[] = [];

    for (const op of ops) {
        try {
            if (op.op === 'set_strategy') {
                const razbor = await pickRazbor(op.razbor);
                if (!razbor) {
                    results.push({ op: op.op, ok: false, what: NO_RAZBOR });
                    continue;
                }
                const text = (op.text ?? '').trim();
                if (!text) {
                    results.push({ op: op.op, ok: false, what: 'пустая стратегия' });
                    continue;
                }
                const { error } = await supabase
                    .from('shtab_razbor')
                    .update({ strategy: text })
                    .eq('id', razbor.id);
                if (error) throw new Error(error.message);
                results.push({ op: op.op, ok: true, what: `записала стратегию в разбор ${razbor.id} (${text.length} знаков)` });
                continue;
            }

            if (op.op === 'set_goal') {
                const razbor = await pickRazbor(op.razbor);
                if (!razbor) {
                    results.push({ op: op.op, ok: false, what: NO_RAZBOR });
                    continue;
                }
                const fields: Record<string, string> = {};
                if (op.goal_fix !== undefined) fields.goal_fix = op.goal_fix.trim();
                if (op.goal_grow !== undefined) fields.goal_grow = op.goal_grow.trim();
                if (Object.keys(fields).length === 0) {
                    results.push({ op: op.op, ok: false, what: 'нечего записывать' });
                    continue;
                }
                const { error } = await supabase.from('shtab_razbor').update(fields).eq('id', razbor.id);
                if (error) throw new Error(error.message);
                results.push({ op: op.op, ok: true, what: `записала цель в разбор ${razbor.id}: ${Object.keys(fields).join(', ')}` });
                continue;
            }

            if (op.op === 'create_block') {
                const razbor = await pickRazbor(op.razbor);
                if (!razbor) {
                    results.push({ op: op.op, ok: false, what: NO_RAZBOR });
                    continue;
                }
                const title = (op.title ?? '').trim();
                if (!title) {
                    results.push({ op: op.op, ok: false, what: 'у блока нет названия' });
                    continue;
                }
                const { data: existing, error: exError } = await supabase
                    .from('shtab_block')
                    .select('id, title, ordinal')
                    .eq('razbor_id', razbor.id)
                    .order('ordinal');
                if (exError) throw new Error(exError.message);
                // Повтор диктовки не удваивает нарезку.
                const same = (existing ?? []).find((b: any) => String(b.title).trim().toLowerCase() === title.toLowerCase());
                if (same) {
                    results.push({ op: op.op, ok: false, what: `блок «${title}» уже есть` });
                    continue;
                }
                const { data: created, error } = await supabase
                    .from('shtab_block')
                    .insert({
                        razbor_id: razbor.id,
                        title,
                        excerpt: op.excerpt ?? '',
                        rationale: op.rationale ?? '',
                        ordinal: existing?.length ?? 0,
                    })
                    .select('id')
                    .single();
                if (error) throw new Error(error.message);
                results.push({ op: op.op, ok: true, what: `завела блок «${title}» (номер ${created.id})` });
                continue;
            }

            if (op.op === 'save_program') {
                const { data: blocks, error: bError } = await supabase.from('shtab_block').select('id, title, razbor_id');
                if (bError) throw new Error(bError.message);
                const needle = String(op.block ?? '').trim().toLowerCase();
                const block = /^\d+$/.test(needle)
                    ? (blocks ?? []).find((b: any) => b.id === Number(needle))
                    : (blocks ?? []).find((b: any) => String(b.title).trim().toLowerCase() === needle) ??
                      (blocks ?? []).find((b: any) => String(b.title).trim().toLowerCase().includes(needle));
                if (!block) {
                    results.push({ op: op.op, ok: false, what: `блока «${op.block}» не нашла — заведи его сначала` });
                    continue;
                }

                // Задачи с неизвестным типом не выбрасываем молча: программа без
                // производственных задач и программа, у которой их не разобрали,
                // выглядят одинаково, а это разные вещи.
                const unknown = (op.tasks ?? []).filter((t) => !TASK_KINDS.includes(t.kind as TaskKind));
                const tasks = (op.tasks ?? [])
                    .filter((t) => TASK_KINDS.includes(t.kind as TaskKind))
                    .map((t, i) => ({
                        kind: t.kind as TaskKind,
                        ordinal: i,
                        text: (t.text ?? '').trim(),
                        why: t.why ?? '',
                        metric: t.metric ?? '',
                        targetValue: t.target_value ?? '',
                        sourceNote: t.source_note ?? '',
                    }))
                    .filter((t) => t.text);

                const draft: ProgramDraft = {
                    mainTask: (op.main_task ?? '').trim(),
                    managerName: (op.manager_name ?? '').trim(),
                    tasks,
                };
                const problems = checkProgram(draft);

                const { data: programId, error } = await supabase.rpc('shtab_save_program', {
                    p_block_id: block.id,
                    p_main_task: draft.mainTask,
                    p_manager: draft.managerName,
                    p_source: 'tamara',
                    p_tasks: tasks,
                });
                if (error) throw new Error(error.message);

                results.push({
                    op: op.op,
                    ok: true,
                    what:
                        `записала программу под блок «${block.title}» (${tasks.length} задач, номер ${programId})` +
                        (unknown.length ? `; ${unknown.length} задач с непонятным типом пропустила` : ''),
                    problems: problems.map((p) => `${p.kind === 'bad' ? 'брак' : 'предупреждение'}: ${p.say}`),
                });
                continue;
            }

            results.push({ op: (op as any).op, ok: false, what: 'неизвестная операция' });
        } catch (e: any) {
            results.push({ op: (op as any).op ?? '?', ok: false, what: `не вышло: ${e.message}` });
        }
    }

    return results;
}
