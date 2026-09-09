import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getSession } from '@/lib/auth';
import { supabase } from '@/utils/supabase';

export const dynamic = 'force-dynamic';

// PATCH /api/shtab/minus/[id] — закрыть, открыть заново или поправить минус.
// Минусы не удаляются: закрытый минус — это история, по которой видно, что
// область действительно расчищается, а не переименовывается.

const PatchSchema = z
    .object({
        text: z.string().trim().min(1).max(500).optional(),
        area_code: z.string().trim().min(1).optional(),
        done: z.boolean().optional(),
    })
    .refine((v) => Object.keys(v).length > 0, { message: 'Нечего менять' });

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
    try {
        const session = await getSession(req);
        if (!session?.user) return NextResponse.json({ error: 'Неавторизован' }, { status: 401 });

        const id = Number(params.id);
        if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: 'Некорректный id' }, { status: 400 });

        const parsed = PatchSchema.safeParse(await req.json());
        if (!parsed.success) {
            return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Некорректные данные' }, { status: 400 });
        }

        const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
        if (parsed.data.text !== undefined) patch.text = parsed.data.text;
        if (parsed.data.area_code !== undefined) {
            const { data: area, error: areaError } = await supabase
                .from('shtab_area')
                .select('code')
                .eq('code', parsed.data.area_code)
                .maybeSingle();
            if (areaError) throw new Error(areaError.message);
            if (!area) return NextResponse.json({ error: 'Неизвестная область' }, { status: 400 });
            patch.area_code = parsed.data.area_code;
        }
        if (parsed.data.done !== undefined) {
            patch.done = parsed.data.done;
            patch.done_at = parsed.data.done ? new Date().toISOString() : null;
        }

        const { data, error } = await supabase
            .from('shtab_minus')
            .update(patch)
            .eq('id', id)
            .select('id, text, area_code, source, occurred_on, done')
            .maybeSingle();
        if (error) throw new Error(error.message);
        if (!data) return NextResponse.json({ error: 'Минус не найден' }, { status: 404 });

        return NextResponse.json(data);
    } catch (e: any) {
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}
