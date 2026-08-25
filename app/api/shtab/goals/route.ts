import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getSession } from '@/lib/auth';
import { supabase } from '@/utils/supabase';
import type { GoalKind } from '@/lib/shtab/types';
import { GOAL_KINDS } from '@/lib/shtab/types';

export const dynamic = 'force-dynamic';

// PUT /api/shtab/goals — три долгосрочные цели разом.
// Строки в таблице заведены миграцией, здесь только upsert по ключу kind.

const GoalsSchema = z
    .object({
        company: z.string().max(4000).optional(),
        owner: z.string().max(4000).optional(),
        product: z.string().max(4000).optional(),
    })
    .refine((v) => Object.keys(v).length > 0, { message: 'Нечего менять' });

export async function PUT(req: NextRequest) {
    try {
        const session = await getSession(req);
        if (!session?.user) return NextResponse.json({ error: 'Неавторизован' }, { status: 401 });

        const parsed = GoalsSchema.safeParse(await req.json());
        if (!parsed.success) {
            return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Некорректные данные' }, { status: 400 });
        }

        const now = new Date().toISOString();
        const rows = GOAL_KINDS.filter((kind) => parsed.data[kind] !== undefined).map((kind) => ({
            kind,
            text: parsed.data[kind] as string,
            updated_at: now,
        }));

        const { error } = await supabase.from('shtab_goal').upsert(rows, { onConflict: 'kind' });
        if (error) throw new Error(error.message);

        const { data, error: readError } = await supabase.from('shtab_goal').select('kind, text');
        if (readError) throw new Error(readError.message);

        const goals = Object.fromEntries(GOAL_KINDS.map((k) => [k, ''])) as Record<GoalKind, string>;
        for (const row of data ?? []) {
            if (GOAL_KINDS.includes(row.kind as GoalKind)) goals[row.kind as GoalKind] = row.text ?? '';
        }

        return NextResponse.json(goals);
    } catch (e: any) {
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}
