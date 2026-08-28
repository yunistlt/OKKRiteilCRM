import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getSession } from '@/lib/auth';
import { supabase } from '@/utils/supabase';

export const dynamic = 'force-dynamic';

// PATCH  /api/shtab/post/[id] — поправить пост.
// DELETE /api/shtab/post/[id] — убрать пост.

const POST_COLUMNS = 'id, title, area_code, ideal_scene, statistic, holder_name, external_uid, ordinal';

const PatchSchema = z
    .object({
        title: z.string().trim().min(1).max(200).optional(),
        area_code: z.string().trim().min(1).nullable().optional(),
        ideal_scene: z.string().max(2000).optional(),
        statistic: z.string().max(500).optional(),
        holder_name: z.string().trim().max(200).optional(),
        // Идентификатор занимающего пост в ЦехУспехе: по нему тамошний
        // консультант находит, чьи это задачи. Пустая строка → null, иначе
        // уникальный индекс споткнётся о второй пустой пост.
        external_uid: z.string().trim().max(200).nullable().optional(),
        ordinal: z.number().int().min(0).optional(),
    })
    .refine((v) => Object.keys(v).length > 0, { message: 'Нечего менять' });

function parseId(raw: string): number | null {
    const id = Number(raw);
    return Number.isInteger(id) && id > 0 ? id : null;
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
    try {
        const session = await getSession(req);
        if (!session?.user) return NextResponse.json({ error: 'Неавторизован' }, { status: 401 });

        const id = parseId(params.id);
        if (!id) return NextResponse.json({ error: 'Некорректный id' }, { status: 400 });

        const parsed = PatchSchema.safeParse(await req.json());
        if (!parsed.success) {
            return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Некорректные данные' }, { status: 400 });
        }

        if (parsed.data.area_code) {
            const { data: area, error: areaError } = await supabase
                .from('shtab_area')
                .select('code')
                .eq('code', parsed.data.area_code)
                .maybeSingle();
            if (areaError) throw new Error(areaError.message);
            if (!area) return NextResponse.json({ error: 'Неизвестная область' }, { status: 400 });
        }

        const { data, error } = await supabase
            .from('shtab_post')
            .update({ ...parsed.data, updated_at: new Date().toISOString() })
            .eq('id', id)
            .select(POST_COLUMNS)
            .maybeSingle();
        if (error) throw new Error(error.message);
        if (!data) return NextResponse.json({ error: 'Пост не найден' }, { status: 404 });

        return NextResponse.json(data);
    } catch (e: any) {
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
    try {
        const session = await getSession(req);
        if (!session?.user) return NextResponse.json({ error: 'Неавторизован' }, { status: 401 });

        const id = parseId(params.id);
        if (!id) return NextResponse.json({ error: 'Некорректный id' }, { status: 400 });

        const { error } = await supabase.from('shtab_post').delete().eq('id', id);
        if (error) throw new Error(error.message);

        return NextResponse.json({ ok: true });
    } catch (e: any) {
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}
