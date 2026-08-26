import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getSession } from '@/lib/auth';
import { supabase } from '@/utils/supabase';

export const dynamic = 'force-dynamic';

// PATCH  /api/shtab/project/[id] — поправить проект или отметить сделанным.
// DELETE /api/shtab/project/[id] — убрать проект.
//
// Проекты, в отличие от минусов, удаляются: минус — это история наблюдений,
// а отменённый проект истории не несёт. Для «решили не делать» есть статус
// dropped — им пользуются, когда причину отказа хочется сохранить.

const PROJECT_COLUMNS = 'id, razbor_id, ordinal, title, owner_name, due_on, status, note';

const PatchSchema = z
    .object({
        title: z.string().trim().min(1).max(300).optional(),
        owner_name: z.string().trim().max(200).optional(),
        due_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Срок должен быть датой').nullable().optional(),
        status: z.enum(['open', 'done', 'dropped']).optional(),
        note: z.string().max(2000).optional(),
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

        const { data, error } = await supabase
            .from('shtab_project')
            .update({ ...parsed.data, updated_at: new Date().toISOString() })
            .eq('id', id)
            .select(PROJECT_COLUMNS)
            .maybeSingle();
        if (error) throw new Error(error.message);
        if (!data) return NextResponse.json({ error: 'Проект не найден' }, { status: 404 });

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

        const { error } = await supabase.from('shtab_project').delete().eq('id', id);
        if (error) throw new Error(error.message);

        return NextResponse.json({ ok: true });
    } catch (e: any) {
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}
