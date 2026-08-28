import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getSession } from '@/lib/auth';
import { supabase } from '@/utils/supabase';

export const dynamic = 'force-dynamic';

// POST /api/shtab/post — завести пост.
// Область необязательна: часть постов (сисадмин, дворник) не ложится ни в одну
// область компании, и заставлять выбирать значило бы врать в справочнике.

const POST_COLUMNS = 'id, title, area_code, ideal_scene, statistic, holder_name, external_uid, ordinal';

const CreateSchema = z.object({
    title: z.string().trim().min(1, 'Название поста пустое').max(200),
    area_code: z.string().trim().min(1).nullable().optional(),
    ideal_scene: z.string().max(2000).default(''),
    statistic: z.string().max(500).default(''),
    holder_name: z.string().trim().max(200).default(''),
});

export async function POST(req: NextRequest) {
    try {
        const session = await getSession(req);
        if (!session?.user) return NextResponse.json({ error: 'Неавторизован' }, { status: 401 });

        const parsed = CreateSchema.safeParse(await req.json());
        if (!parsed.success) {
            return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Некорректные данные' }, { status: 400 });
        }
        const areaCode = parsed.data.area_code ?? null;

        if (areaCode) {
            const { data: area, error: areaError } = await supabase
                .from('shtab_area')
                .select('code')
                .eq('code', areaCode)
                .maybeSingle();
            if (areaError) throw new Error(areaError.message);
            if (!area) return NextResponse.json({ error: 'Неизвестная область' }, { status: 400 });
        }

        const { count, error: countError } = await supabase
            .from('shtab_post')
            .select('id', { count: 'exact', head: true });
        if (countError) throw new Error(countError.message);

        const { data, error } = await supabase
            .from('shtab_post')
            .insert({ ...parsed.data, area_code: areaCode, ordinal: count ?? 0 })
            .select(POST_COLUMNS)
            .single();
        if (error) throw new Error(error.message);

        return NextResponse.json(data, { status: 201 });
    } catch (e: any) {
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}
