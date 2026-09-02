import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getSession } from '@/lib/auth';
import { supabase } from '@/utils/supabase';

export const dynamic = 'force-dynamic';

// POST /api/shtab/razbor — начать разбор области.
// Разбор создаётся пустым: методичка требует, чтобы владелец сам написал
// ситуацию и «почему», подставлять сюда текст минуса нельзя — иначе на месте
// разбора окажется переписанный заголовок.

const CreateSchema = z.object({
    area_code: z.string().trim().min(1),
    minus_id: z.number().int().positive().nullable().optional(),
});

export async function POST(req: NextRequest) {
    try {
        const session = await getSession(req);
        if (!session?.user) return NextResponse.json({ error: 'Неавторизован' }, { status: 401 });

        const parsed = CreateSchema.safeParse(await req.json());
        if (!parsed.success) {
            return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Некорректные данные' }, { status: 400 });
        }

        const { data: area, error: areaError } = await supabase
            .from('shtab_area')
            .select('code')
            .eq('code', parsed.data.area_code)
            .maybeSingle();
        if (areaError) throw new Error(areaError.message);
        if (!area) return NextResponse.json({ error: 'Неизвестная область' }, { status: 400 });

        const { data, error } = await supabase
            .from('shtab_razbor')
            .insert({ area_code: parsed.data.area_code, minus_id: parsed.data.minus_id ?? null })
            .select(
                'id, area_code, status, minus_id, situation, why, check_inside, check_res, check_relief, goal_fix, goal_grow, strategy, created_at',
            )
            .single();
        if (error) throw new Error(error.message);

        return NextResponse.json({ ...data, resources: [] }, { status: 201 });
    } catch (e: any) {
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}
