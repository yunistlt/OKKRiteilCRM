import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getSession } from '@/lib/auth';
import { supabase } from '@/utils/supabase';
import { formatKnowledge, getTamaraPrompt, parseStructured, renderTemplate, runTamara, searchTamaraKnowledge } from '@/lib/shtab/tamara';
import { PROGRAM_SCHEMA } from '@/lib/shtab/program-schema';
import { goalLine, programFacts, renderProgramExample, taskKindTitles } from '@/lib/shtab/program-context';
import { checkProgram } from '@/lib/shtab/program-checks';
import type { ProgramDraft } from '@/lib/shtab/programs';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

// POST /api/shtab/tamara/program — Тамара пишет программу под логический блок.
//
// Возвращается черновик вместе с находками проверок: проверки детерминированы и
// прогоняются здесь же, чтобы владелец увидел брак сразу, а не после сохранения.
// В базу черновик кладёт он сам.

const Schema = z.object({ block_id: z.number().int().positive() });

export async function POST(req: NextRequest) {
    try {
        const session = await getSession(req);
        if (!session?.user) return NextResponse.json({ error: 'Неавторизован' }, { status: 401 });

        const parsed = Schema.safeParse(await req.json());
        if (!parsed.success) {
            return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Некорректные данные' }, { status: 400 });
        }

        const { data: block, error } = await supabase
            .from('shtab_block')
            .select('id, razbor_id, title, excerpt, rationale')
            .eq('id', parsed.data.block_id)
            .maybeSingle();
        if (error) throw new Error(error.message);
        if (!block) return NextResponse.json({ error: 'Блок не найден' }, { status: 404 });

        const { data: razbor } = await supabase
            .from('shtab_razbor')
            .select('goal_fix, goal_grow')
            .eq('id', block.razbor_id)
            .maybeSingle();

        const [prompt, knowledge, titles, facts] = await Promise.all([
            getTamaraPrompt('shtab_tamara_program'),
            searchTamaraKnowledge(`программа под блок ${block.title}: обратный отсчёт, производственные задачи`),
            taskKindTitles(),
            programFacts(block.razbor_id),
        ]);

        const answer = await runTamara({
            prompt,
            purpose: 'shtab_tamara_program',
            // Инструменты доступны: числа для производственных задач Тамара берёт
            // из них, а чего инструменты не дали — оставляет пропуском с замером.
            schema: PROGRAM_SCHEMA as any,
            userContent: renderTemplate(prompt.userPromptTemplate, {
                block_title: block.title,
                block_excerpt: block.excerpt || '',
                goal: goalLine(razbor?.goal_fix, razbor?.goal_grow),
                facts,
                knowledge_context: formatKnowledge(knowledge),
                example: renderProgramExample(titles),
            }),
        });

        const draft = parseStructured<ProgramDraft>(answer.reply, 'Программа');
        // Пустые строки вместо null: схема разрешает null, а дальше по коду и в
        // базе поля не обнуляемые.
        draft.tasks = (draft.tasks ?? []).map((t) => ({
            ...t,
            why: t.why ?? '',
            metric: t.metric ?? '',
            targetValue: t.targetValue ?? '',
            sourceNote: t.sourceNote ?? '',
        }));

        return NextResponse.json({
            program: draft,
            problems: checkProgram(draft),
            used_tools: answer.usedTools.map((t) => t.name),
            model: answer.model,
        });
    } catch (e: any) {
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}
