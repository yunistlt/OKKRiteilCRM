import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getSession } from '@/lib/auth';
import { supabase } from '@/utils/supabase';
import { MINUS_SOURCES } from '@/lib/shtab/types';

export const dynamic = 'force-dynamic';

// POST /api/shtab/minus — завести минус.
// Область приходит с клиента уже подсказанной (lib/shtab/checks.guessArea), но
// здесь всё равно проверяется по справочнику: подсказка — это подсказка.

const CreateSchema = z.object({
    text: z.string().trim().min(1, 'Текст минуса пустой').max(500),
    area_code: z.string().trim().min(1),
    source: z.enum(MINUS_SOURCES as [string, ...string[]]).default('owner'),
});

export async function POST(req: NextRequest) {
    try {
        const session = await getSession(req);
        if (!session?.user) return NextResponse.json({ error: 'Неавторизован' }, { status: 401 });

        const parsed = CreateSchema.safeParse(await req.json());
        if (!parsed.success) {
            return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Некорректные данные' }, { status: 400 });
        }
        const { text, area_code, source } = parsed.data;

        const { data: area, error: areaError } = await supabase
            .from('shtab_area')
            .select('code')
            .eq('code', area_code)
            .maybeSingle();
        if (areaError) throw new Error(areaError.message);
        if (!area) return NextResponse.json({ error: 'Неизвестная область' }, { status: 400 });

        const { data, error } = await supabase
            .from('shtab_minus')
            .insert({ text, area_code, source })
            .select('id, text, area_code, source, occurred_on, done')
            .single();
        if (error) throw new Error(error.message);

        return NextResponse.json(data, { status: 201 });
    } catch (e: any) {
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}
