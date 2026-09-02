import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getSession } from '@/lib/auth';
import { supabase } from '@/utils/supabase';
import { checkProgram } from '@/lib/shtab/program-checks';
import { TASK_KINDS } from '@/lib/shtab/programs';
import type { ProgramDraft } from '@/lib/shtab/programs';

export const dynamic = 'force-dynamic';

// POST /api/shtab/program — сохранить программу целиком.
//
// Одной функцией в базе, а не серией запросов: наполовину сохранённая программа —
// с главной задачей и шагами, но без производственных задач — это ровно тот брак,
// ради исключения которого весь слой и заведён.

const TaskSchema = z.object({
    kind: z.enum(TASK_KINDS),
    ordinal: z.number().int().min(0).default(0),
    text: z.string().trim().min(1, 'Пустая задача').max(2000),
    why: z.string().max(2000).optional().default(''),
    metric: z.string().max(300).optional().default(''),
    targetValue: z.string().max(300).optional().default(''),
    sourceNote: z.string().max(600).optional().default(''),
});

const Schema = z.object({
    block_id: z.number().int().positive(),
    mainTask: z.string().trim().max(1000),
    managerName: z.string().trim().max(300),
    source: z.enum(['tamara', 'owner']).default('owner'),
    tasks: z.array(TaskSchema).max(80),
});

export async function POST(req: NextRequest) {
    try {
        const session = await getSession(req);
        if (!session?.user) return NextResponse.json({ error: 'Неавторизован' }, { status: 401 });

        const parsed = Schema.safeParse(await req.json());
        if (!parsed.success) {
            return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Некорректные данные' }, { status: 400 });
        }
        const body = parsed.data;

        const { data, error } = await supabase.rpc('shtab_save_program', {
            p_block_id: body.block_id,
            p_main_task: body.mainTask,
            p_manager: body.managerName,
            p_source: body.source,
            p_tasks: body.tasks,
        });
        if (error) throw new Error(error.message);

        // Находки возвращаются вместе с ответом: сохранение они не блокируют —
        // программа принадлежит владельцу, — но он должен их видеть.
        const draft: ProgramDraft = {
            mainTask: body.mainTask,
            managerName: body.managerName,
            tasks: body.tasks,
        };

        return NextResponse.json({ ok: true, program_id: data, problems: checkProgram(draft) });
    } catch (e: any) {
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}
