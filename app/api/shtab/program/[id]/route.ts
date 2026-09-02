import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getSession } from '@/lib/auth';
import { supabase } from '@/utils/supabase';

export const dynamic = 'force-dynamic';

// PATCH /api/shtab/program/[id] — закрепить программу за постом, сменить статус.
//
// Ответственный — это ПОСТ, а не строка с фамилией. Пока работа описана через
// людей, организация держится на конкретном человеке: с его уходом функция
// исчезает вместе со знанием о том, что она была. Программа закреплена за постом,
// у поста есть занимающий, у занимающего — учётка в ЦехУспехе, по которой
// тамошний консультант находит его задачи.

const Schema = z.object({
    post_id: z.number().int().positive().nullable().optional(),
    status: z.enum(['draft', 'active', 'done', 'dropped']).optional(),
});

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
    try {
        const session = await getSession(req);
        if (!session?.user) return NextResponse.json({ error: 'Неавторизован' }, { status: 401 });

        const id = Number(params.id);
        if (!Number.isFinite(id)) return NextResponse.json({ error: 'Некорректный id' }, { status: 400 });

        const parsed = Schema.safeParse(await req.json());
        if (!parsed.success) {
            return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Некорректные данные' }, { status: 400 });
        }
        if (Object.keys(parsed.data).length === 0) {
            return NextResponse.json({ error: 'Нечего менять' }, { status: 400 });
        }

        const { data, error } = await supabase
            .from('shtab_program')
            .update({ ...parsed.data, updated_at: new Date().toISOString() })
            .eq('id', id)
            .select('id, block_id, main_task, manager_name, status, source, post_id')
            .single();
        if (error) throw new Error(error.message);

        return NextResponse.json(data);
    } catch (e: any) {
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}
