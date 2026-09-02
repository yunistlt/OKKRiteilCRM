import { supabase } from '@/utils/supabase';
import { FEW_SHOT_PROGRAMS } from '@/lib/shtab/program-example';
import { KIND_ORDER, tasksOfKind, TASK_KINDS } from '@/lib/shtab/programs';
import type { ProgramDraft } from '@/lib/shtab/programs';

// Сборка контекста для написания программы.
//
// Всё, что уходит модели, собирается ЗДЕСЬ, в коде, а не выпрашивается у неё
// инструментами по ходу. Причина та же, что у понедельничной сводки: два запуска
// должны видеть одни и те же факты, иначе сослаться на написанную программу будет
// нельзя — она окажется написанной по другим данным.

/** Названия типов задач из справочника: русские подписи в базе, а не в коде. */
export async function taskKindTitles(): Promise<Record<string, { title: string; hint: string }>> {
    const { data, error } = await supabase.from('shtab_task_kind').select('code, title, hint').order('ordinal');
    if (error) throw new Error(error.message);
    return Object.fromEntries((data ?? []).map((r: any) => [r.code, { title: r.title, hint: r.hint }]));
}

/** Образец формы для промпта. Разворачивается по группам, как его читает человек. */
export function renderProgramExample(titles: Record<string, { title: string }>): string {
    const render = (p: ProgramDraft, n: number): string => {
        const lines = [`ПРИМЕР ${n}`, `Главная задача: ${p.mainTask}`, `Руководитель: ${p.managerName}`];
        for (const kind of [...TASK_KINDS].sort((a, b) => KIND_ORDER[a] - KIND_ORDER[b])) {
            const group = tasksOfKind(p.tasks, kind);
            if (group.length === 0) continue;
            lines.push('', titles[kind]?.title ?? kind);
            for (const t of group) {
                const parts = [`${t.ordinal}. ${t.text}`];
                if (t.why) parts.push(`   почему: ${t.why}`);
                if (t.metric) parts.push(`   меряем: ${t.metric}`);
                if (t.targetValue) parts.push(`   цель: ${t.targetValue}`);
                // Пропуск показывается намеренно: модель должна увидеть, что число
                // можно не назвать, но тогда обязательно назвать замер.
                if (!t.targetValue && t.sourceNote) parts.push(`   цель пока не известна, берётся из: ${t.sourceNote}`);
                lines.push(parts.join('\n'));
            }
        }
        return lines.join('\n');
    };
    return FEW_SHOT_PROGRAMS.map(render).join('\n\n———\n\n');
}

/** Ресурсы и цель разбора — то, из чего программа обязана собираться. */
export async function programFacts(razborId: number): Promise<string> {
    const [{ data: razbor }, { data: resources }] = await Promise.all([
        supabase.from('shtab_razbor').select('goal_fix, goal_grow, situation, why').eq('id', razborId).maybeSingle(),
        supabase.from('shtab_resource').select('title, note, ordinal').eq('razbor_id', razborId).order('ordinal'),
    ]);

    const lines: string[] = [];
    if (razbor?.situation) lines.push(`Ситуация: ${razbor.situation}`);
    if (razbor?.why) lines.push(`Почему так: ${razbor.why}`);

    const list = resources ?? [];
    if (list.length === 0) {
        // Не молчим об этом: без карты ресурсов программа соберётся из выдуманного.
        lines.push('Карта ресурсов пуста. Ресурсов, из которых можно собрать программу, не назвали.');
    } else {
        lines.push('Карта ресурсов:');
        for (const r of list) lines.push(`— ${r.title}${r.note ? ` (${r.note})` : ''}`);
    }

    return lines.join('\n');
}

export function goalLine(goalFix?: string | null, goalGrow?: string | null): string {
    const parts = [goalFix?.trim(), goalGrow?.trim()].filter(Boolean);
    return parts.length > 0 ? parts.join(' Плюс: ') : 'Краткосрочная цель не сформулирована.';
}
